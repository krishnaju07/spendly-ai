import { PLATFORMS, PLATFORM_BY_SLUG, type PlatformDef } from './catalog/platforms';
import { matchKeywordRule } from './categorize';
import {
  REVIEW_CONFIDENCE_THRESHOLD,
  type ClassificationSource,
  type TransactionType,
} from './constants';
import { parseNarration, type Channel } from './narration';
import { ruleMatches, sortRules, type MerchantRuleLike } from './rules';
import {
  displayName,
  escapeRegExp,
  normalizeText,
  stripCorporateSuffixes,
  stripTrailingLocation,
} from './text';

/**
 * Platform recognition engine.
 *
 * Order of evidence (first decisive result wins):
 *   1. the user's own rules, highest priority first (incl. rules learned from corrections)
 *   2. the user's custom platforms (their aliases)
 *   3. exact merchant aliases from the platform directory
 *   4. carefully bounded patterns from the platform directory
 *   5. keyword rules (transfers, income, refunds, categories without a platform)
 *   6. nothing matched -> "default": the caller may ask an AI classifier, then the user
 *
 * Every result carries a confidence and a human-readable reason so uncertain matches can be shown
 * to the user instead of silently trusted. Matching is deterministic and side-effect free.
 */

export interface RecognitionInput {
  /** Bank/card narration or any free-text description. */
  description?: string | null;
  /** An explicit merchant/payee value when the source has one. */
  merchant?: string | null;
  /** Direction of money as stated by the source, when known. */
  direction?: 'debit' | 'credit' | null;
}

export interface CustomPlatformLike {
  slug: string;
  name: string;
  category?: string | null;
  /** Merchant strings that identify this platform (matched as whole words). */
  aliases: string[];
}

export interface RecognitionContext {
  rules?: readonly MerchantRuleLike[];
  customPlatforms?: readonly CustomPlatformLike[];
}

export interface Recognition {
  merchantName: string;
  /** Stable grouping key: "p:<platform>" for known platforms, otherwise "m:<normalised merchant>". */
  merchantKey: string;
  platform: string | null;
  category: string | null;
  subcategory: string | null;
  typeHint: TransactionType | null;
  confidence: number;
  source: ClassificationSource;
  reason: string;
  needsReview: boolean;
  ruleId: string | null;
  channel: Channel;
  personToPerson: boolean;
}

interface CompiledPattern {
  platform: PlatformDef;
  re: RegExp;
  confidence: number;
  reason: string;
  category?: string;
  subcategory?: string;
}

let compiledPatterns: CompiledPattern[] | null = null;
let aliasIndex: Map<string, PlatformDef> | null = null;

function getCompiled(): CompiledPattern[] {
  if (compiledPatterns) return compiledPatterns;
  compiledPatterns = PLATFORMS.flatMap((platform) =>
    platform.patterns.map((p) => ({
      platform,
      re: new RegExp(p.source),
      confidence: p.confidence,
      reason: p.reason,
      category: p.category,
      subcategory: p.subcategory,
    })),
  );
  return compiledPatterns;
}

function getAliasIndex(): Map<string, PlatformDef> {
  if (aliasIndex) return aliasIndex;
  aliasIndex = new Map();
  for (const platform of PLATFORMS) {
    for (const alias of platform.aliases) aliasIndex.set(stripCorporateSuffixes(normalizeText(alias)), platform);
  }
  return aliasIndex;
}

const EXACT_ALIAS_CONFIDENCE = 0.97;
/** Below this a pattern is too ambiguous to assign a platform — it is only offered as a suggestion. */
const MIN_ASSIGN_CONFIDENCE = 0.5;

interface PatternHit {
  platform: PlatformDef;
  confidence: number;
  reason: string;
  category?: string;
  subcategory?: string;
  matchLength: number;
  source: 'alias' | 'pattern';
}

function bestPlatformHit(text: string): PatternHit | null {
  let best: PatternHit | null = null;
  const consider = (hit: PatternHit) => {
    if (
      !best ||
      hit.confidence > best.confidence ||
      (hit.confidence === best.confidence && hit.matchLength > best.matchLength) ||
      (hit.confidence === best.confidence &&
        hit.matchLength === best.matchLength &&
        hit.platform.kind === 'brand' &&
        best.platform.kind === 'general')
    ) {
      best = hit;
    }
  };

  const alias = getAliasIndex().get(stripCorporateSuffixes(text));
  if (alias) {
    consider({
      platform: alias,
      confidence: EXACT_ALIAS_CONFIDENCE,
      reason: `Merchant name matches "${alias.name}" exactly`,
      matchLength: text.length,
      source: 'alias',
    });
  }
  for (const c of getCompiled()) {
    const m = c.re.exec(text);
    if (!m) continue;
    consider({
      platform: c.platform,
      confidence: c.confidence,
      reason: c.reason,
      category: c.category,
      subcategory: c.subcategory,
      matchLength: m[0].length,
      source: 'pattern',
    });
  }
  return best;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/** Compact grouping key: drops reference-like tokens and keeps the leading merchant words. */
function merchantKeyFromText(normalized: string): string {
  const tokens = normalized
    .split(' ')
    .filter((t) => t && !/^\d+$/.test(t) && !(t.length >= 9 && /\d/.test(t)));
  return tokens.slice(0, 4).join(' ');
}

function resolveType(
  fullNorm: string,
  direction: 'debit' | 'credit' | null,
  platform: PlatformDef | null,
): { type: TransactionType; category: string; subcategory: string | null; reason: string; confidence: number } | null {
  const rule = matchKeywordRule(fullNorm, direction, (k) => k.type !== undefined);
  if (rule?.type && rule.confidence >= 0.8) {
    return {
      type: rule.type,
      category: rule.category,
      subcategory: rule.subcategory ?? null,
      reason: rule.reason,
      confidence: rule.confidence,
    };
  }
  if (direction === 'credit' && platform && platform.kind === 'brand') {
    return {
      type: 'refund',
      category: platform.category,
      subcategory: platform.subcategory ?? null,
      reason: `Money received from ${platform.name} — treated as a refund. Change it if it is something else`,
      confidence: 0.72,
    };
  }
  return null;
}

export function recognize(input: RecognitionInput, ctx: RecognitionContext = {}): Recognition {
  const description = (input.description ?? '').trim();
  const explicitMerchant = (input.merchant ?? '').trim();
  const direction = input.direction ?? null;

  const narration = description ? parseNarration(description) : null;
  const channel: Channel = narration?.channel ?? 'unknown';
  const personToPerson = narration?.personToPerson ?? false;

  const explicitNorm = explicitMerchant ? normalizeText(explicitMerchant) : '';
  const narrationNorm = narration?.merchant ?? '';
  const fullNorm = normalizeText([explicitMerchant, description].filter(Boolean).join(' '));

  const merchantTexts = uniqueNonEmpty([explicitNorm, narrationNorm]);
  const searchTexts = uniqueNonEmpty([...merchantTexts, fullNorm]);

  const primaryNorm = stripTrailingLocation(stripCorporateSuffixes(merchantTexts[0] ?? fullNorm));
  const fallbackName = displayName(merchantKeyFromText(primaryNorm) || 'Unknown merchant');
  const unknownKey = `m:${merchantKeyFromText(primaryNorm)}`;

  const base = {
    channel,
    personToPerson,
  };

  // 1 ── user rules ───────────────────────────────────────────────────────────────────────
  const rules = sortRules(ctx.rules ?? []);
  const targets = {
    merchants: uniqueNonEmpty([explicitMerchant, narration?.merchant ?? '']),
    description,
  };
  for (const rule of rules) {
    if (!ruleMatches(rule, targets)) continue;
    const platformDef = rule.platform ? (PLATFORM_BY_SLUG.get(rule.platform) ?? null) : null;
    const customName = rule.platform ? ctx.customPlatforms?.find((c) => c.slug === rule.platform)?.name : undefined;
    return {
      ...base,
      merchantName: platformDef?.name ?? customName ?? fallbackName,
      merchantKey: rule.platform ? `p:${rule.platform}` : unknownKey,
      platform: rule.platform ?? null,
      category: rule.category ?? platformDef?.category ?? null,
      subcategory: rule.subcategory ?? (rule.category ? null : (platformDef?.subcategory ?? null)),
      typeHint: rule.type ?? null,
      confidence: rule.source === 'user' ? 1 : 0.95,
      source: rule.source === 'user' ? 'user_rule' : 'learned_rule',
      reason:
        rule.source === 'user'
          ? `Matched your rule "${rule.name ?? rule.pattern}"`
          : `Matched a rule learned from your earlier correction ("${rule.pattern}")`,
      needsReview: false,
      ruleId: rule.id,
    };
  }

  // 2 ── custom platforms ─────────────────────────────────────────────────────────────────
  for (const custom of ctx.customPlatforms ?? []) {
    for (const alias of custom.aliases) {
      const needle = normalizeText(alias);
      if (!needle) continue;
      const re = new RegExp(`(?:^| )${escapeRegExp(needle)}(?: |$)`);
      if (searchTexts.some((t) => re.test(t))) {
        return {
          ...base,
          merchantName: custom.name,
          merchantKey: `p:${custom.slug}`,
          platform: custom.slug,
          category: custom.category ?? null,
          subcategory: null,
          typeHint: resolveType(fullNorm, direction, null)?.type ?? null,
          confidence: EXACT_ALIAS_CONFIDENCE,
          source: 'alias',
          reason: `Matched your custom platform "${custom.name}"`,
          needsReview: false,
          ruleId: null,
        };
      }
    }
  }

  // 3 + 4 ── platform directory ─────────────────────────────────────────────────────────────
  let hit: PatternHit | null = null;
  for (const text of searchTexts) {
    const candidate = bestPlatformHit(text);
    if (!candidate) continue;
    if (!hit || candidate.confidence > hit.confidence) hit = candidate;
    if (candidate.confidence >= REVIEW_CONFIDENCE_THRESHOLD) break;
  }

  let suggestion: PatternHit | null = null;
  if (hit && hit.confidence < MIN_ASSIGN_CONFIDENCE) {
    suggestion = hit;
    hit = null;
  }

  if (hit) {
    const platform = hit.platform;
    const typed = resolveType(fullNorm, direction, platform);
    const category = typed?.type === 'refund' || !typed ? (hit.category ?? platform.category) : typed.category;
    const subcategory =
      typed && typed.type !== 'refund'
        ? typed.subcategory
        : hit.category
          ? (hit.subcategory ?? null)
          : (hit.subcategory ?? platform.subcategory ?? null);
    const confidence = hit.confidence;
    return {
      ...base,
      merchantName: platform.kind === 'brand' ? platform.name : fallbackName,
      merchantKey: platform.kind === 'brand' ? `p:${platform.slug}` : unknownKey,
      platform: platform.slug,
      category,
      subcategory,
      typeHint: typed?.type ?? null,
      confidence,
      source: hit.source,
      reason: typed && typed.type === 'refund' ? `${hit.reason}. ${typed.reason}` : hit.reason,
      needsReview: confidence < REVIEW_CONFIDENCE_THRESHOLD,
      ruleId: null,
    };
  }

  // 5 ── keyword rules ───────────────────────────────────────────────────────────────────────
  const keyword = matchKeywordRule(fullNorm, direction);
  if (keyword) {
    const bankingNoise = keyword.id === 'cc-bill-payment' || keyword.id === 'own-account' || keyword.id === 'atm';
    return {
      ...base,
      merchantName: keyword.displayName && (bankingNoise || fallbackName === 'Unknown merchant') ? keyword.displayName : fallbackName,
      merchantKey: bankingNoise && keyword.displayName ? `m:${keyword.displayName.toUpperCase()}` : unknownKey,
      platform: null,
      category: keyword.category,
      subcategory: keyword.subcategory ?? null,
      typeHint: keyword.type ?? null,
      confidence: keyword.confidence,
      source: 'keyword',
      reason: keyword.reason,
      needsReview: keyword.confidence < REVIEW_CONFIDENCE_THRESHOLD || personToPerson,
      ruleId: null,
    };
  }

  // 6 ── nothing matched ─────────────────────────────────────────────────────────────────────
  if (direction === 'credit') {
    return {
      ...base,
      merchantName: fallbackName,
      merchantKey: unknownKey,
      platform: null,
      category: 'income',
      subcategory: 'Other income',
      typeHint: 'income',
      confidence: 0.4,
      source: 'default',
      reason: 'Money received with no recognisable source — marked as income. Change it to a refund or transfer if needed',
      needsReview: true,
      ruleId: null,
    };
  }

  return {
    ...base,
    merchantName: fallbackName,
    merchantKey: unknownKey,
    platform: null,
    category: null,
    subcategory: null,
    typeHint: null,
    confidence: 0,
    source: 'default',
    reason: suggestion
      ? `This could be ${suggestion.platform.name}, but the text is too ambiguous to assume — please choose`
      : personToPerson
        ? 'Payment to an individual — please choose a category'
        : 'No rule matched this merchant — please choose a category',
    needsReview: true,
    ruleId: null,
  };
}

/** Test/debug helper: drops cached compiled patterns (e.g. after mutating the catalog in a test). */
export function resetRecognitionCache(): void {
  compiledPatterns = null;
  aliasIndex = null;
}

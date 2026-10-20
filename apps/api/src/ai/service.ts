import { z } from 'zod';
import {
  collectNumbers,
  escapeRegExp,
  queryPlanSchema,
  redactSensitive,
  validateNarrative,
  type AiStatusDto,
  type QueryPlan,
} from '@spendly/shared';
import { logger } from '../lib/logger';
import type { UserPreferenceDoc } from '../models/account';
import type { Lookups } from '../services/lookups';
import { AiProviderError, extractJson, getProvider, type LlmImage } from './providers';

export type AiFeature = 'narrate' | 'parseQuestions' | 'classifyMerchants' | 'readReceipts';
export type AiGate = { allowed: true } | { allowed: false; reason: 'no_provider' | 'user_disabled' | 'feature_disabled' };

/** Nothing is ever sent unless a provider is configured *and* the user has opted in to that feature. */
export function aiGate(prefs: Pick<UserPreferenceDoc, 'ai'>, feature: AiFeature): AiGate {
  if (!getProvider()) return { allowed: false, reason: 'no_provider' };
  if (!prefs.ai.enabled) return { allowed: false, reason: 'user_disabled' };
  if (feature === 'classifyMerchants' && !prefs.ai.classifyUnknownMerchants) return { allowed: false, reason: 'feature_disabled' };
  if (feature === 'readReceipts' && !prefs.ai.readReceipts) return { allowed: false, reason: 'feature_disabled' };
  return { allowed: true };
}

export function aiStatus(prefs: Pick<UserPreferenceDoc, 'ai'>): AiStatusDto {
  const provider = getProvider();
  const sends: string[] = [];
  if (provider && prefs.ai.enabled) {
    sends.push('The text of the question you type in the AI Money Coach (account numbers, emails and phone numbers are masked first).');
    sends.push('Verified totals computed by Spendly for that question: amounts, counts, percentages, date ranges and category names.');
    sends.push(
      prefs.ai.shareMerchantNames
        ? 'Platform and merchant names that appear in those results.'
        : 'Platform and merchant names are replaced with neutral labels (like "Platform A") before sending.',
    );
    if (prefs.ai.classifyUnknownMerchants) sends.push('Merchant text from statement rows that the built-in rules could not recognise (masked, no amounts or dates).');
    if (prefs.ai.readReceipts) sends.push('Receipt images you choose to read with AI.');
  }
  return {
    provider: { configured: Boolean(provider), name: provider?.id ?? null, model: provider?.model ?? null },
    userEnabled: prefs.ai.enabled,
    active: Boolean(provider) && prefs.ai.enabled,
    capabilities: {
      narrate: aiGate(prefs, 'narrate').allowed,
      parseQuestions: aiGate(prefs, 'parseQuestions').allowed,
      classifyMerchants: aiGate(prefs, 'classifyMerchants').allowed,
      readReceipts: aiGate(prefs, 'readReceipts').allowed,
    },
    sends,
    neverSends: [
      'Individual transactions, descriptions, notes or tags (except merchant text for classification, if you enabled it).',
      'Your name, email address, password, session or any bank / card / UPI credentials.',
      'Your full transaction history.',
    ],
  };
}

// ── name masking ───────────────────────────────────────────────────────────────────────────────

interface Masker {
  mask(text: string): string;
  unmask(text: string): string;
}

/** Reversible masking of merchant/platform names, so a provider never sees them unless the user allowed it. */
function buildMasker(names: string[]): Masker {
  const unique = [...new Set(names.filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  const aliasByName = new Map<string, string>();
  unique.forEach((name, i) => aliasByName.set(name.toLowerCase(), `Platform ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`));
  const nameRe = unique.length ? new RegExp(`\\b(${unique.map(escapeRegExp).join('|')})\\b`, 'gi') : null;
  const originalByAlias = new Map([...aliasByName].map(([name, alias]) => [alias, unique.find((u) => u.toLowerCase() === name) as string]));
  const aliasRe = aliasByName.size ? new RegExp(`\\b(${[...originalByAlias.keys()].map(escapeRegExp).join('|')})\\b`, 'g') : null;
  return {
    mask: (text) => (nameRe ? text.replace(nameRe, (m) => aliasByName.get(m.toLowerCase()) ?? m) : text),
    unmask: (text) => (aliasRe ? text.replace(aliasRe, (m) => originalByAlias.get(m) ?? m) : text),
  };
}

const identityMasker: Masker = { mask: (t) => t, unmask: (t) => t };

function maskerFor(prefs: Pick<UserPreferenceDoc, 'ai'>, lookups: Lookups): Masker {
  if (prefs.ai.shareMerchantNames) return identityMasker;
  return buildMasker([...lookups.platforms.values()].map((p) => p.name));
}

// ── narration ──────────────────────────────────────────────────────────────────────────────────

const NARRATE_SYSTEM = `You are the explanation layer of a personal spending tracker. You receive FACTS, a JSON object computed by deterministic code from the user's own transactions, plus the user's QUESTION.

Rules:
- Use ONLY numbers that appear in FACTS, copied exactly as written in the "display" strings. Never calculate, round, estimate or invent any other number, percentage, date or count.
- Do not state anything that FACTS does not support. If the data does not show something, say so.
- Start with the direct answer in one or two sentences, then at most two more sentences of context (comparison, main driver, or a caveat about coverage).
- Plain language. No markdown, no lists, no headings. Under 90 words.
- Keep anything marked as an estimate clearly labelled as an estimate. Phrase suggestions as options, never certainties, and never claim a subscription can be cancelled or that savings are guaranteed.
- This is budgeting guidance, not investment, tax or legal advice.`;

export type NarrateResult = { ok: true; text: string; model: string } | { ok: false; reason: string; unsupported?: string[] };

export async function narrate(opts: {
  prefs: Pick<UserPreferenceDoc, 'ai'>;
  lookups: Lookups;
  question: string;
  facts: unknown;
}): Promise<NarrateResult> {
  const gate = aiGate(opts.prefs, 'narrate');
  const provider = getProvider();
  if (!gate.allowed || !provider) return { ok: false, reason: gate.allowed ? 'no_provider' : gate.reason };

  const masker = maskerFor(opts.prefs, opts.lookups);
  const payload = masker.mask(`QUESTION: ${redactSensitive(opts.question)}\nFACTS: ${JSON.stringify(opts.facts)}`);
  try {
    const response = await provider.complete({ system: NARRATE_SYSTEM, user: payload, effort: 'low' });
    const text = masker.unmask(response.text).trim();
    if (text.length > 1200) return { ok: false, reason: 'too_long' };
    const validation = validateNarrative(text, collectNumbers(opts.facts));
    if (!validation.passed) {
      logger.warn({ unsupported: validation.unsupported }, 'AI narrative rejected: numbers not in verified facts');
      return { ok: false, reason: 'unverified_numbers', unsupported: validation.unsupported };
    }
    return { ok: true, text, model: response.model };
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : 'unavailable';
    logger.warn({ code }, 'AI narration failed; using deterministic explanation');
    return { ok: false, reason: code };
  }
}

// ── question → plan ────────────────────────────────────────────────────────────────────────────

const PLAN_SYSTEM = `You convert a user's question about their own spending into a JSON query plan. You never answer the question and you never see any financial data.

Return ONE JSON object and nothing else. Allowed shapes:
{"intent":"spend_total","period":P,"filter":F}
{"intent":"top_categories","period":P,"limit":1-15}
{"intent":"top_platforms","period":P,"limit":1-15}
{"intent":"compare_platforms","period":P,"platforms":[slugA,slugB]}
{"intent":"share_of_spend","period":P,"filter":F}
{"intent":"what_changed","period":P}
{"intent":"what_if_reduce","filter":F,"percent":1-100,"horizonMonths":1-60}
{"intent":"subscriptions_review"}
{"intent":"savings_opportunities"}
{"intent":"budget_status"}
{"intent":"help","reason":"why the question cannot be answered"}

P (period) is one of: {"kind":"preset","preset":"today|yesterday|this_week|last_week|this_month|last_month|last_7_days|last_30_days|last_90_days|this_quarter|last_quarter|this_year|last_year|this_fy|last_fy|last_12_months"}, {"kind":"last_days","days":N}, {"kind":"last_months","months":N}, {"kind":"month","month":"YYYY-MM"}, {"kind":"range","from":"YYYY-MM-DD","to":"YYYY-MM-DD"}.
F (filter) is {"label":"short human label","categories":[slug…],"platforms":[slug…]} using ONLY the slugs listed below. If the user did not specify a period use {"kind":"preset","preset":"this_month"}.`;

const sanitizeSlugs = (list: string[] | undefined, known: Map<string, unknown>) => {
  const kept = (list ?? []).filter((s) => known.has(s));
  return kept.length ? kept : undefined;
};

export async function planWithLlm(opts: {
  prefs: Pick<UserPreferenceDoc, 'ai'>;
  lookups: Lookups;
  question: string;
  today: string;
}): Promise<QueryPlan | null> {
  const gate = aiGate(opts.prefs, 'parseQuestions');
  const provider = getProvider();
  if (!gate.allowed || !provider) return null;

  const categories = [...opts.lookups.categories.values()].filter((c) => c.kind === 'spending').map((c) => `${c.slug} (${c.name})`);
  const platforms = [...opts.lookups.platforms.values()].map((p) => `${p.slug} (${p.name})`);
  const user = `Today is ${opts.today}.\nCategory slugs: ${categories.join(', ')}\nPlatform slugs: ${platforms.join(', ')}\n\nQUESTION: ${redactSensitive(opts.question)}`;
  try {
    const response = await provider.complete({ system: PLAN_SYSTEM, user, effort: 'low', maxTokens: 2000 });
    const parsed = queryPlanSchema.safeParse(extractJson(response.text));
    if (!parsed.success) return null;
    const plan = parsed.data;
    if ('filter' in plan) {
      plan.filter.categories = sanitizeSlugs(plan.filter.categories, opts.lookups.categories);
      plan.filter.platforms = sanitizeSlugs(plan.filter.platforms, opts.lookups.platforms);
      if (!plan.filter.categories && !plan.filter.platforms && plan.intent !== 'spend_total') return null;
    }
    if (plan.intent === 'compare_platforms' && !plan.platforms.every((p) => opts.lookups.platforms.has(p))) return null;
    return plan;
  } catch (error) {
    logger.warn({ code: error instanceof AiProviderError ? error.code : 'unavailable' }, 'AI question parsing failed; falling back');
    return null;
  }
}

// ── merchant classification ────────────────────────────────────────────────────────────────────

const classificationSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      platform: z.string().nullable().optional(),
      category: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string().max(240).optional(),
    }),
  ),
});

export interface AiClassification {
  platform: string | null;
  category: string;
  confidence: number;
  reason: string;
}

const CLASSIFY_SYSTEM = `You classify merchant text from Indian bank, card and UPI statements. For each item choose the best category and, only if you are confident the merchant IS that platform, a platform.
If unsure, use category "other" with low confidence — never guess a platform. Keep "reason" under 120 characters.
Return ONE JSON object and nothing else: {"results":[{"id":"…","platform":"slug-or-null","category":"slug","confidence":0.0-1.0,"reason":"…"}]}`;

/** Classifies merchants the deterministic rules could not place. Text is masked; no amounts or dates are sent. */
export async function classifyWithLlm(opts: {
  prefs: Pick<UserPreferenceDoc, 'ai'>;
  lookups: Lookups;
  items: Array<{ id: string; text: string }>;
}): Promise<Map<string, AiClassification>> {
  const out = new Map<string, AiClassification>();
  const gate = aiGate(opts.prefs, 'classifyMerchants');
  const provider = getProvider();
  if (!gate.allowed || !provider || opts.items.length === 0) return out;

  const categories = [...opts.lookups.categories.values()].map((c) => `${c.slug} (${c.name})`);
  const platforms = [...opts.lookups.platforms.values()].map((p) => `${p.slug} (${p.name})`);
  for (let i = 0; i < opts.items.length; i += 25) {
    const batch = opts.items.slice(i, i + 25);
    const user = `Categories: ${categories.join(', ')}\nPlatforms: ${platforms.join(', ')}\n\nItems:\n${batch
      .map((b) => `${b.id}: ${redactSensitive(b.text).slice(0, 120)}`)
      .join('\n')}`;
    try {
      const response = await provider.complete({ system: CLASSIFY_SYSTEM, user, effort: 'low', maxTokens: 4000 });
      const parsed = classificationSchema.safeParse(extractJson(response.text));
      if (!parsed.success) continue;
      for (const r of parsed.data.results) {
        if (!opts.lookups.categories.has(r.category)) continue;
        const platform = r.platform && opts.lookups.platforms.has(r.platform) ? r.platform : null;
        out.set(r.id, {
          platform,
          category: r.category,
          confidence: Math.min(0.85, r.confidence),
          reason: `AI suggestion: ${r.reason ?? 'matched by merchant text'}`.slice(0, 200),
        });
      }
    } catch (error) {
      logger.warn({ code: error instanceof AiProviderError ? error.code : 'unavailable' }, 'AI classification batch failed');
    }
  }
  return out;
}

// ── receipts ───────────────────────────────────────────────────────────────────────────────────

const receiptSchema = z.object({
  merchant: z.string().max(120).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total: z.string().max(30).nullable().optional(),
  currency: z.string().max(5).nullable().optional(),
});
export type ReceiptReading = z.infer<typeof receiptSchema>;

export async function readReceiptWithLlm(prefs: Pick<UserPreferenceDoc, 'ai'>, image: LlmImage): Promise<ReceiptReading | null> {
  const gate = aiGate(prefs, 'readReceipts');
  const provider = getProvider();
  if (!gate.allowed || !provider?.supportsVision) return null;
  try {
    const response = await provider.complete({
      system:
        'You read purchase receipts. Return ONE JSON object and nothing else: {"merchant":string|null,"date":"YYYY-MM-DD"|null,"total":"amount as printed, digits and decimal point only"|null,"currency":"INR"|…|null}. Use null for anything you cannot read clearly. Never guess.',
      user: 'Read this receipt.',
      image,
      effort: 'low',
      maxTokens: 2000,
    });
    const parsed = receiptSchema.safeParse(extractJson(response.text));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logger.warn({ code: error instanceof AiProviderError ? error.code : 'unavailable' }, 'AI receipt reading failed');
    return null;
  }
}

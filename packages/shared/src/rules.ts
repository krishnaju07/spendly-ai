import type { TransactionType } from './constants';
import { escapeRegExp, normalizeText } from './text';

export const RULE_MATCH_TYPES = ['exact', 'contains', 'starts_with', 'regex'] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const RULE_FIELDS = ['merchant', 'description', 'any'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/** The shape of a user (or learned) merchant rule as the recognition engine sees it. */
export interface MerchantRuleLike {
  id: string;
  name?: string;
  matchType: RuleMatchType;
  pattern: string;
  field: RuleField;
  platform?: string | null;
  category?: string | null;
  subcategory?: string | null;
  type?: TransactionType | null;
  /** Higher runs first. */
  priority: number;
  isActive: boolean;
  source: 'user' | 'learned';
}

const MAX_REGEX_LENGTH = 120;
const MAX_MATCH_INPUT = 500;

/**
 * User-supplied regexes run on the server for every imported row, so a pathological pattern
 * ("(a+)+$") could stall the event loop. This is a conservative screen, not a proof: it rejects
 * the classic catastrophic shapes and anything long enough to hide one.
 */
export function validateRegexPattern(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (pattern.length === 0) return { ok: false, reason: 'Pattern is empty' };
  if (pattern.length > MAX_REGEX_LENGTH) {
    return { ok: false, reason: `Pattern is longer than ${MAX_REGEX_LENGTH} characters` };
  }
  try {
    new RegExp(pattern, 'i');
  } catch (error) {
    return { ok: false, reason: `Invalid regular expression: ${(error as Error).message}` };
  }
  if (/\\[1-9]/.test(pattern)) return { ok: false, reason: 'Back-references are not allowed' };
  // a quantified group that itself contains a quantifier: (a+)+ (a*)* (a|b+)* (.+)+
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(pattern)) {
    return { ok: false, reason: 'Nested quantifiers can make matching extremely slow' };
  }
  if ((pattern.match(/\.\*|\.\+/g) ?? []).length > 3) {
    return { ok: false, reason: 'Too many wildcard repeats' };
  }
  return { ok: true };
}

export type RulePatternValidation = { ok: true } | { ok: false; reason: string };

export function validateRulePattern(matchType: RuleMatchType, pattern: string): RulePatternValidation {
  if (matchType === 'regex') return validateRegexPattern(pattern);
  if (normalizeText(pattern).length === 0) {
    return { ok: false, reason: 'Pattern needs at least one letter or digit' };
  }
  return { ok: true };
}

export interface RuleTargets {
  /** Merchant text candidates, raw (e.g. the merchant column and the extracted payee). */
  merchants: string[];
  description: string;
}

const regexCache = new Map<string, RegExp | null>();

function compiled(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern) ?? null;
  let re: RegExp | null = null;
  if (validateRegexPattern(pattern).ok) re = new RegExp(pattern, 'i');
  regexCache.set(pattern, re);
  return re;
}

function matchesText(rule: MerchantRuleLike, raw: string): boolean {
  const text = raw.slice(0, MAX_MATCH_INPUT);
  if (rule.matchType === 'regex') {
    const re = compiled(rule.pattern);
    return re ? re.test(text) : false;
  }
  const haystack = normalizeText(text);
  const needle = normalizeText(rule.pattern);
  if (!needle || !haystack) return false;
  switch (rule.matchType) {
    case 'exact':
      return haystack === needle;
    case 'starts_with':
      return haystack === needle || haystack.startsWith(`${needle} `);
    case 'contains':
      return new RegExp(`(?:^| )${escapeRegExp(needle)}(?: |$)`).test(haystack);
  }
}

export function ruleMatches(rule: MerchantRuleLike, targets: RuleTargets): boolean {
  if (!rule.isActive) return false;
  const candidates: string[] =
    rule.field === 'merchant'
      ? targets.merchants
      : rule.field === 'description'
        ? [targets.description]
        : [...targets.merchants, targets.description];
  return candidates.some((c) => c.length > 0 && matchesText(rule, c));
}

/** Rules evaluate highest priority first; ties go to the more specific match type, then user over learned. */
export function sortRules(rules: readonly MerchantRuleLike[]): MerchantRuleLike[] {
  const specificity: Record<RuleMatchType, number> = { exact: 3, starts_with: 2, contains: 1, regex: 0 };
  return [...rules].sort(
    (a, b) =>
      b.priority - a.priority ||
      specificity[b.matchType] - specificity[a.matchType] ||
      (a.source === b.source ? 0 : a.source === 'user' ? -1 : 1),
  );
}

export interface SuggestedRule {
  matchType: RuleMatchType;
  pattern: string;
  field: RuleField;
  name: string;
}

/**
 * When a user corrects a classification we offer to remember it. The pattern is the merchant key
 * (already normalised, without corporate suffixes or locations) so it generalises to the same
 * merchant's future transactions without swallowing unrelated ones.
 */
export function suggestRuleFromMerchant(merchantKey: string, displayName: string): SuggestedRule | null {
  const key = normalizeText(merchantKey.replace(/^[pm]:/, ''));
  const tokens = key.split(' ').filter((t) => t.length > 1 && !/^\d+$/.test(t));
  if (tokens.length === 0) return null;
  const pattern = tokens.slice(0, 3).join(' ');
  if (pattern.length < 3) return null;
  return { matchType: 'contains', pattern, field: 'any', name: `${displayName} → remembered` };
}

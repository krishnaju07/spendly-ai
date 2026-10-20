import { z } from 'zod';
import { CATEGORIES } from './catalog/categories';
import { PLATFORMS } from './catalog/platforms';
import { PAYMENT_METHODS } from './constants';

/**
 * The AI Money Coach never lets a language model do arithmetic. A question becomes a structured
 * QueryPlan (deterministically, or via an LLM that only sees the question text), the plan is run
 * as database queries, and the result is a CoachAnswer made of verified figures. A model may
 * rephrase the answer, but its text is rejected if it contains a number that is not in the facts.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'this_fy',
  'last_fy',
  'last_12_months',
] as const;

export const periodSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(PERIOD_PRESETS) }),
  z.object({ kind: z.literal('range'), from: isoDate, to: isoDate }),
  z.object({ kind: z.literal('last_days'), days: z.number().int().min(1).max(730) }),
  z.object({ kind: z.literal('last_months'), months: z.number().int().min(1).max(36) }),
  z.object({ kind: z.literal('month'), month: z.string().regex(/^\d{4}-\d{2}$/) }),
]);
export type PeriodSpec = z.infer<typeof periodSpecSchema>;

export const spendFilterSchema = z.object({
  /** Human label for the thing being asked about, e.g. "food delivery". */
  label: z.string().max(80).optional(),
  categories: z.array(z.string().max(80)).max(20).optional(),
  platforms: z.array(z.string().max(80)).max(20).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});
export type SpendFilter = z.infer<typeof spendFilterSchema>;

const limit = z.number().int().min(1).max(15);

export const queryPlanSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('spend_total'), period: periodSpecSchema, filter: spendFilterSchema }),
  z.object({ intent: z.literal('top_categories'), period: periodSpecSchema, limit }),
  z.object({ intent: z.literal('top_platforms'), period: periodSpecSchema, limit }),
  z.object({
    intent: z.literal('compare_platforms'),
    period: periodSpecSchema,
    platforms: z.array(z.string().max(80)).length(2),
  }),
  z.object({ intent: z.literal('share_of_spend'), period: periodSpecSchema, filter: spendFilterSchema }),
  z.object({ intent: z.literal('what_changed'), period: periodSpecSchema }),
  z.object({
    intent: z.literal('what_if_reduce'),
    filter: spendFilterSchema,
    percent: z.number().min(1).max(100),
    horizonMonths: z.number().int().min(1).max(60),
  }),
  z.object({ intent: z.literal('subscriptions_review') }),
  z.object({ intent: z.literal('savings_opportunities') }),
  z.object({ intent: z.literal('budget_status') }),
  z.object({ intent: z.literal('help'), reason: z.string().max(300).optional() }),
]);
export type QueryPlan = z.infer<typeof queryPlanSchema>;
export type QueryIntent = QueryPlan['intent'];

// ── Answer shape (shared with the web app) ─────────────────────────────────────────────────────

export type StatementKind = 'verified' | 'estimate' | 'suggestion';

export interface CoachMetric {
  key: string;
  label: string;
  kind: 'verified' | 'estimate';
  display: string;
  paise?: number;
  value?: number;
}

export interface CoachBreakdownRow {
  slug?: string;
  label: string;
  paise: number;
  display: string;
  count?: number;
  sharePct?: number | null;
  changePct?: number | null;
}

export interface CoachAnswer {
  question: string;
  plan: QueryPlan;
  /** The direct answer, always first. */
  headline: string;
  period: { label: string; from: string; to: string } | null;
  baseline: { label: string; from: string; to: string } | null;
  metrics: CoachMetric[];
  breakdown: CoachBreakdownRow[];
  /** Plain-English calculation / evidence steps. */
  calculation: string[];
  coverage: {
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
    transactionsConsidered: number;
    uncategorizedSharePct: number | null;
    isDemo: boolean;
    notes: string[];
  };
  confidence: { level: 'high' | 'medium' | 'low'; reason: string };
  statements: Array<{ kind: StatementKind; text: string }>;
  nextAction?: { label: string; href?: string; prompt?: string };
  assumptions: string[];
  transactionsHref?: string;
  explanation: {
    source: 'deterministic' | 'llm';
    text: string;
    validation?: { passed: boolean; issues: string[] };
  };
  disclaimer: string;
}

export const COACH_DISCLAIMER =
  'Budgeting guidance based on your own transaction data — not professional investment, tax or legal advice.';

// ── Question parsing ───────────────────────────────────────────────────────────────────────────

export interface LexiconEntry {
  slug: string;
  name: string;
  terms: string[];
}
export interface LexiconGroup {
  label: string;
  platforms: string[];
  terms: string[];
}
export interface Lexicon {
  platforms: LexiconEntry[];
  categories: LexiconEntry[];
  groups: LexiconGroup[];
}

const CATEGORY_TERMS: Record<string, string[]> = {
  'food-delivery': ['food delivery', 'food ordering', 'online food', 'delivery apps', 'ordering food', 'takeaway', 'takeout'],
  'dining-out': ['dining out', 'dining', 'restaurants', 'eating out', 'cafes', 'cafe', 'coffee'],
  groceries: ['groceries', 'grocery', 'supermarket'],
  entertainment: ['entertainment', 'movies', 'movie', 'events', 'cinema'],
  shopping: ['shopping', 'online shopping', 'clothes', 'fashion'],
  transport: ['travel', 'transport', 'transportation', 'cabs', 'rides', 'commute', 'taxi'],
  subscriptions: ['subscriptions', 'subscription', 'streaming', 'ott', 'memberships'],
  bills: ['bills', 'utilities', 'utility bills', 'recharge', 'electricity', 'internet'],
  rent: ['rent', 'housing'],
  fuel: ['fuel', 'petrol', 'diesel'],
  health: ['health', 'medical', 'medicine', 'pharmacy', 'doctor', 'healthcare'],
  education: ['education', 'courses', 'tuition'],
  'personal-care': ['personal care', 'gym', 'fitness', 'salon'],
  gifts: ['gifts', 'donations'],
  cash: ['cash', 'atm'],
  fees: ['fees', 'charges'],
};

const PLATFORM_EXTRA_TERMS: Record<string, string[]> = {
  bookmyshow: ['book my show', 'bms'],
  'swiggy-instamart': ['instamart'],
  'amazon-fresh': ['amazon fresh'],
  'youtube-premium': ['youtube', 'youtube premium'],
  'prime-video': ['prime video', 'amazon prime', 'prime'],
  'google-services': ['google one', 'google'],
  'apple-services': ['icloud', 'apple'],
  'flights-hotels': ['flights', 'hotels', 'flight'],
  'movie-theatres': ['theatres', 'theaters', 'pvr', 'inox'],
};

/** Lexicon of everything the coach can be asked about; callers add the user's custom items. */
export function buildLexicon(extra?: { platforms?: LexiconEntry[]; categories?: LexiconEntry[] }): Lexicon {
  const platforms: LexiconEntry[] = PLATFORMS.map((p) => ({
    slug: p.slug,
    name: p.name,
    terms: [p.name.toLowerCase(), p.slug.replace(/-/g, ' '), ...(PLATFORM_EXTRA_TERMS[p.slug] ?? [])],
  }));
  const categories: LexiconEntry[] = CATEGORIES.filter((c) => c.kind === 'spending').map((c) => ({
    slug: c.slug,
    name: c.name,
    terms: [c.name.toLowerCase(), ...(CATEGORY_TERMS[c.slug] ?? [])],
  }));
  return {
    platforms: [...platforms, ...(extra?.platforms ?? [])],
    categories: [...categories, ...(extra?.categories ?? [])],
    groups: [
      {
        label: 'quick commerce',
        platforms: ['zepto', 'blinkit', 'swiggy-instamart', 'bigbasket', 'amazon-fresh'],
        terms: ['quick commerce', 'quick-commerce', 'q-commerce', 'instant delivery'],
      },
    ],
  };
}

export interface ParsedQuestion {
  plan: QueryPlan;
  assumptions: string[];
  /** "high" when intent and entities were recognised; "low" means the caller may try an LLM parser. */
  confidence: 'high' | 'low';
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function toNumber(token: string): number | null {
  const n = Number(token);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';

export function parsePeriod(text: string, now: Date, tz: string): PeriodSpec | null {
  const t = text.toLowerCase();
  const lastN = new RegExp(`\\b(?:last|past|previous)\\s+${NUM}\\s+(day|days|week|weeks|month|months)\\b`).exec(t);
  if (lastN) {
    const n = toNumber(lastN[1] as string);
    const unit = lastN[2] as string;
    if (n && unit.startsWith('day')) return { kind: 'last_days', days: Math.min(730, n) };
    if (n && unit.startsWith('week')) return { kind: 'last_days', days: Math.min(730, n * 7) };
    if (n && unit.startsWith('month')) return { kind: 'last_months', months: Math.min(36, n) };
  }
  const presets: Array<[RegExp, (typeof PERIOD_PRESETS)[number]]> = [
    [/\byesterday\b/, 'yesterday'],
    [/\btoday\b/, 'today'],
    [/\b(this|current) week\b/, 'this_week'],
    [/\blast week\b|\bprevious week\b/, 'last_week'],
    [/\blast month\b|\bprevious month\b/, 'last_month'],
    [/\b(this|current) month\b|\bmonth to date\b|\bso far\b/, 'this_month'],
    [/\blast quarter\b/, 'last_quarter'],
    [/\b(this|current) quarter\b/, 'this_quarter'],
    [/\blast (financial year|fy)\b/, 'last_fy'],
    [/\b(this|current) (financial year|fy)\b/, 'this_fy'],
    [/\blast year\b|\bprevious year\b/, 'last_year'],
    [/\b(this|current) year\b|\byear to date\b|\bytd\b/, 'this_year'],
    [/\b(a|per|over the) year\b(?!.*\bago\b)/, 'last_12_months'],
  ];
  for (const [re, preset] of presets) if (re.test(t)) return { kind: 'preset', preset };

  const monthMatch = new RegExp(`\\b(?:in|for|during|of)\\s+(${MONTH_NAMES.join('|')})(?:\\s+(\\d{4}))?\\b`).exec(t);
  if (monthMatch) {
    const monthIdx = MONTH_NAMES.indexOf(monthMatch[1] as string) + 1;
    const nowParts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric' }).formatToParts(now);
    const curYear = Number(nowParts.find((p) => p.type === 'year')?.value);
    const curMonth = Number(nowParts.find((p) => p.type === 'month')?.value);
    const year = monthMatch[2] ? Number(monthMatch[2]) : monthIdx > curMonth ? curYear - 1 : curYear;
    return { kind: 'month', month: `${year}-${String(monthIdx).padStart(2, '0')}` };
  }
  return null;
}

function findEntities(text: string, lexicon: Lexicon) {
  const t = ` ${text.toLowerCase().replace(/[?.!,]/g, ' ')} `;
  const hit = (terms: string[]) =>
    terms
      .filter((term) => t.includes(` ${term} `) || t.includes(` ${term}s `))
      .sort((a, b) => b.length - a.length)[0];

  const groups = lexicon.groups.filter((g) => hit(g.terms));
  const platforms = lexicon.platforms
    .map((p) => ({ p, term: hit(p.terms) }))
    .filter((x): x is { p: LexiconEntry; term: string } => Boolean(x.term))
    .sort((a, b) => b.term.length - a.term.length);
  const categories = lexicon.categories
    .map((c) => ({ c, term: hit(c.terms) }))
    .filter((x): x is { c: LexiconEntry; term: string } => Boolean(x.term))
    .sort((a, b) => b.term.length - a.term.length);

  // drop platform hits whose words are only part of a longer platform hit ("swiggy" inside "swiggy instamart")
  const keptPlatforms: typeof platforms = [];
  for (const cand of platforms) {
    const covered = keptPlatforms.some((k) => k.term.includes(cand.term) && k.term !== cand.term);
    if (!covered) keptPlatforms.push(cand);
  }
  return { groups, platforms: keptPlatforms.map((x) => x.p), categories: categories.map((x) => x.c) };
}

function filterFrom(entities: ReturnType<typeof findEntities>): SpendFilter | null {
  if (entities.groups.length > 0) {
    const g = entities.groups[0] as LexiconGroup;
    return { label: g.label, platforms: g.platforms };
  }
  if (entities.categories.length > 0) {
    const first = entities.categories[0] as LexiconEntry;
    // a platform named alongside a category narrows the question to that platform
    if (entities.platforms.length > 0) {
      const p = entities.platforms[0] as LexiconEntry;
      return { label: p.name, platforms: [p.slug] };
    }
    return { label: first.name.toLowerCase(), categories: [first.slug] };
  }
  if (entities.platforms.length > 0) {
    const p = entities.platforms[0] as LexiconEntry;
    return { label: p.name, platforms: [p.slug] };
  }
  return null;
}

/** Deterministic question → plan parser. Unrecognised questions become a `help` plan. */
export function parseQuestion(
  question: string,
  lexicon: Lexicon,
  opts: { now?: Date; tz?: string } = {},
): ParsedQuestion {
  const now = opts.now ?? new Date();
  const tz = opts.tz ?? 'Asia/Kolkata';
  const q = question.trim().slice(0, 500);
  const t = q.toLowerCase();
  const assumptions: string[] = [];
  const period = parsePeriod(t, now, tz);
  const entities = findEntities(q, lexicon);
  const filter = filterFrom(entities);

  const periodOrDefault = (): PeriodSpec => {
    if (period) return period;
    assumptions.push('No time period mentioned — using this month so far.');
    return { kind: 'preset', preset: 'this_month' };
  };

  const percentMatch = /(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/.exec(t);
  const topN = new RegExp(`\\btop\\s+${NUM}\\b`).exec(t);
  const limitN = Math.min(15, Math.max(1, topN ? (toNumber(topN[1] as string) ?? 5) : 5));

  // what-if: "if I reduce my Zomato spending by 20%, how much can I save in a year?"
  if (/\b(if i|what if|suppose)\b/.test(t) && /\b(reduce|cut|lower|decrease|drop|skip|spend less|save)\b/.test(t)) {
    if (filter && percentMatch) {
      const months = new RegExp(`\\b(?:in|over|for|next)\\s+${NUM}\\s+months?\\b`).exec(t);
      const horizon = months ? (toNumber(months[1] as string) ?? 12) : /\b(per|a|each|every) month|monthly\b/.test(t) ? 1 : 12;
      if (!months && !/\byear|annual|12 months\b/.test(t)) assumptions.push('No horizon mentioned — projecting over 12 months.');
      return {
        plan: { intent: 'what_if_reduce', filter, percent: Math.min(100, Number(percentMatch[1])), horizonMonths: Math.max(1, Math.min(60, horizon)) },
        assumptions,
        confidence: 'high',
      };
    }
    return {
      plan: { intent: 'help', reason: 'To run a what-if I need both what to reduce (a platform or category) and by how much, e.g. "If I cut Zomato by 20%…".' },
      assumptions,
      confidence: 'low',
    };
  }

  if (entities.platforms.length >= 2 && /\b(or|vs\.?|versus|compare|compared|which)\b/.test(t)) {
    return {
      plan: {
        intent: 'compare_platforms',
        period: periodOrDefault(),
        platforms: [(entities.platforms[0] as LexiconEntry).slug, (entities.platforms[1] as LexiconEntry).slug],
      },
      assumptions,
      confidence: 'high',
    };
  }

  if (/\bsubscriptions?\b|\brecurring\b/.test(t) && /\b(review|cancel|unused|worth|should|waste|drop)\b/.test(t)) {
    return { plan: { intent: 'subscriptions_review' }, assumptions, confidence: 'high' };
  }

  if (/\b(budget|limit)s?\b/.test(t) && /\b(left|remaining|status|doing|exceed|over|used|track)\b/.test(t)) {
    return { plan: { intent: 'budget_status' }, assumptions, confidence: 'high' };
  }

  if (/\b(how (can|do|could) i save|save money|cut (back|down)|savings?|where can i (cut|save)|reduce my spending)\b/.test(t) && !percentMatch) {
    return { plan: { intent: 'savings_opportunities' }, assumptions, confidence: 'high' };
  }

  if (/\b(top|biggest|largest|highest|most)\b/.test(t) && /\b(categor(y|ies))\b/.test(t)) {
    return { plan: { intent: 'top_categories', period: periodOrDefault(), limit: limitN }, assumptions, confidence: 'high' };
  }
  if (/\b(top|biggest|largest|highest|most)\b/.test(t) && /\b(platforms?|apps?|merchants?|sites?)\b/.test(t)) {
    return { plan: { intent: 'top_platforms', period: periodOrDefault(), limit: limitN }, assumptions, confidence: 'high' };
  }

  if (/\b(what changed|what's changed|what has changed|changed|difference|why (did|is|has)|compared (to|with)|vs last)\b/.test(t)) {
    return { plan: { intent: 'what_changed', period: periodOrDefault() }, assumptions, confidence: 'high' };
  }

  if (/\b(percentage|percent|share|proportion|how much of)\b/.test(t) && /\b(spend|spending|spent|goes?|money|expenses?)\b/.test(t)) {
    if (filter) return { plan: { intent: 'share_of_spend', period: periodOrDefault(), filter }, assumptions, confidence: 'high' };
    return { plan: { intent: 'top_categories', period: periodOrDefault(), limit: 8 }, assumptions, confidence: 'low' };
  }

  if (/\b(how much|total|spent|spend|spending|cost)\b/.test(t)) {
    if (filter) return { plan: { intent: 'spend_total', period: periodOrDefault(), filter }, assumptions, confidence: 'high' };
    return {
      plan: { intent: 'spend_total', period: periodOrDefault(), filter: { label: 'everything' } },
      assumptions,
      confidence: period ? 'high' : 'low',
    };
  }

  return { plan: { intent: 'help' }, assumptions, confidence: 'low' };
}

// ── Output validation ──────────────────────────────────────────────────────────────────────────

/** Every number that appears anywhere in a fact sheet, plus rupee equivalents of paise values. */
export function collectNumbers(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    out.add(value / 100);
    out.add(Math.round(value));
    out.add(Math.round(Math.abs(value) / 100));
    out.add(Math.abs(value));
  } else if (typeof value === 'string') {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(n)) out.add(n);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
  return out;
}

const SUFFIX: Record<string, number> = { k: 1e3, l: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };

interface ExtractedNumber {
  text: string;
  values: number[];
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  for (const m of text.matchAll(/(?:₹|Rs\.?\s?|INR\s?)?(\d[\d,]*(?:\.\d+)?)\s?(k|lakhs?|l|crores?|cr|%)?(?![\w])/gi)) {
    const base = Number((m[1] as string).replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const suffix = (m[2] ?? '').toLowerCase();
    const values = suffix && suffix !== '%' && SUFFIX[suffix] ? [base * (SUFFIX[suffix] as number), base] : [base];
    out.push({ text: m[0].trim(), values });
  }
  return out;
}

export interface NarrativeValidation {
  passed: boolean;
  /** Numbers in the narrative that no verified fact supports. */
  unsupported: string[];
}

/**
 * A model-written explanation passes only if every number in it matches a figure in the verified
 * fact sheet (allowing rounding to the nearest rupee/whole percent and lakh/crore shorthand).
 * Anything else falls back to the deterministic explanation.
 */
export function validateNarrative(text: string, allowed: ReadonlySet<number>): NarrativeValidation {
  const allowedList = [...allowed];
  const supported = (v: number): boolean =>
    allowedList.some((a) => Math.abs(a - v) <= 0.51 || (a !== 0 && Math.abs(a - v) / Math.abs(a) <= 0.006));
  const unsupported: string[] = [];
  for (const num of extractNumbers(text)) {
    if (!num.values.some(supported)) unsupported.push(num.text);
  }
  return { passed: unsupported.length === 0, unsupported };
}

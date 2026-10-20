import { decomposeChange } from './budget';
import type { StatementKind } from './coach';
import { categoryName, DISCRETIONARY_CATEGORY_SLUGS } from './catalog/categories';
import { platformName } from './catalog/platforms';
import { localParts } from './dates';
import { formatINR, medianPaise, percentChange } from './money';
import type { RecurringCandidate } from './recurring';

/**
 * Deterministic behaviour detectors. Every insight is computed from stored transactions, carries
 * the evidence and calculation behind it, and separates verified facts from estimates and
 * suggestions. A language model may later rephrase the text, but never invents the numbers.
 */

export const INSIGHT_TYPES = [
  'category_change',
  'platform_change',
  'frequent_small_purchases',
  'weekend_spending',
  'late_night_orders',
  'discretionary_trend',
  'repeated_purchases',
  'unusual_transaction',
  'possible_duplicate',
  'subscription_review',
  'savings_opportunity',
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export interface InsightTxn {
  id: string;
  date: Date;
  amountPaise: number;
  type: 'expense' | 'refund';
  category: string | null;
  platform: string | null;
  merchantKey: string;
  merchantName: string;
  hasTime: boolean;
}

interface PeriodInfo {
  from: Date;
  to: Date;
  fromDate: string;
  toDate: string;
  label: string;
}

export interface InsightContext {
  tz: string;
  now: Date;
  current: PeriodInfo & { days: number; elapsedDays: number };
  baseline: PeriodInfo;
  /** Net discretionary spend per complete month, oldest → newest (excludes the current month). */
  monthlyDiscretionaryPaise: number[];
  avgMonthlyByCategory: Record<string, { avgPaise: number; months: number; cv: number }>;
  recurring: RecurringCandidate[];
}

export interface InsightDraft {
  key: string;
  type: InsightType;
  severity: 'info' | 'positive' | 'warning';
  title: string;
  summary: string;
  statements: Array<{ kind: StatementKind; text: string }>;
  evidence: {
    periodFrom: string;
    periodTo: string;
    baselineFrom?: string;
    baselineTo?: string;
    amountPaise?: number;
    baselinePaise?: number;
    changePct?: number | null;
    txnCount?: number;
    baselineCount?: number;
    calculation: string[];
    transactionIds?: string[];
    scope?: { category?: string; platform?: string };
  };
  confidence: number;
  estimatedMonthlySavingsPaise?: number;
  action?: string;
}

const fmt = (p: number) => formatINR(p, { decimals: 'never' });
const pctText = (p: number | null) => (p === null ? 'new' : Math.round(p) === 0 ? 'unchanged' : `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`);

export function confidenceLabel(c: number): 'low' | 'medium' | 'high' {
  return c >= 0.75 ? 'high' : c >= 0.55 ? 'medium' : 'low';
}

interface Group {
  gross: number;
  refunds: number;
  count: number;
  net: number;
}

function groupBy(rows: readonly InsightTxn[], keyOf: (t: InsightTxn) => string | null): Map<string, Group> {
  const map = new Map<string, Group>();
  for (const t of rows) {
    const key = keyOf(t);
    if (!key) continue;
    const g = map.get(key) ?? { gross: 0, refunds: 0, count: 0, net: 0 };
    if (t.type === 'expense') {
      g.gross += t.amountPaise;
      g.count += 1;
    } else g.refunds += t.amountPaise;
    g.net = g.gross - g.refunds;
    map.set(key, g);
  }
  return map;
}

const within = (rows: readonly InsightTxn[], p: { from: Date; to: Date }) =>
  rows.filter((t) => t.date >= p.from && t.date < p.to);

const driverSentence = (cur: Group, base: Group): string | null => {
  if (cur.count === 0 || base.count === 0) return null;
  const d = decomposeChange({ count: cur.count, totalPaise: cur.gross }, { count: base.count, totalPaise: base.gross });
  const curAvg = Math.round(cur.gross / cur.count);
  const baseAvg = Math.round(base.gross / base.count);
  const noun = (n: number) => `${n} purchase${n === 1 ? '' : 's'}`;
  if (d.driver === 'frequency')
    return `Most of the change came from ${cur.count > base.count ? 'more' : 'fewer'} purchases (${noun(cur.count)} vs ${base.count}), not from the size of each one (average ${fmt(curAvg)} vs ${fmt(baseAvg)}).`;
  if (d.driver === 'order_value')
    return `Most of the change came from the size of each purchase (average ${fmt(curAvg)} vs ${fmt(baseAvg)}), not how often (${noun(cur.count)} vs ${base.count}).`;
  if (d.driver === 'mixed')
    return `Both how often (${noun(cur.count)} vs ${base.count}) and the average purchase (${fmt(curAvg)} vs ${fmt(baseAvg)}) moved.`;
  return null;
};

function evidenceBase(ctx: InsightContext) {
  return {
    periodFrom: ctx.current.fromDate,
    periodTo: ctx.current.toDate,
    baselineFrom: ctx.baseline.fromDate,
    baselineTo: ctx.baseline.toDate,
  };
}

// ── detectors ──────────────────────────────────────────────────────────────────────────────────

function changes(
  ctx: InsightContext,
  cur: readonly InsightTxn[],
  base: readonly InsightTxn[],
  scope: 'category' | 'platform',
  limit: number,
): InsightDraft[] {
  const keyOf = (t: InsightTxn) => (scope === 'category' ? t.category : t.platform);
  const curMap = groupBy(cur, keyOf);
  const baseMap = groupBy(base, keyOf);
  const keys = new Set([...curMap.keys(), ...baseMap.keys()]);
  const candidates: Array<{ key: string; c: Group; b: Group; delta: number }> = [];
  for (const key of keys) {
    const c = curMap.get(key) ?? { gross: 0, refunds: 0, count: 0, net: 0 };
    const b = baseMap.get(key) ?? { gross: 0, refunds: 0, count: 0, net: 0 };
    const delta = c.net - b.net;
    if (Math.abs(delta) >= Math.max(50_000, Math.abs(b.net) * 0.15)) candidates.push({ key, c, b, delta });
  }
  candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const young = ctx.current.elapsedDays < 7;

  return candidates.slice(0, limit).map(({ key, c, b, delta }) => {
    const name = scope === 'category' ? categoryName(key) : platformName(key);
    const pct = percentChange(c.net, b.net);
    const up = delta > 0;
    const driver = driverSentence(c, b);
    const discretionary = scope === 'category' ? DISCRETIONARY_CATEGORY_SLUGS.includes(key) : true;
    const minCount = Math.min(c.count, b.count);
    let confidence = minCount >= 5 ? 0.85 : minCount >= 3 ? 0.7 : 0.55;
    if (young) confidence -= 0.2;
    const headline =
      b.net === 0
        ? `${name}: ${fmt(c.net)} this period, with nothing in the comparison period.`
        : `${name}: ${fmt(c.net)} vs ${fmt(b.net)} (${pctText(pct)}).`;
    return {
      key: `${scope}_change:${key}:${ctx.current.toDate.slice(0, 7)}`,
      type: scope === 'category' ? 'category_change' : 'platform_change',
      severity: up ? (discretionary ? 'warning' : 'info') : 'positive',
      title: `${name} spending ${b.net === 0 ? 'is new' : up ? `up ${Math.abs(Math.round(pct ?? 0))}%` : `down ${Math.abs(Math.round(pct ?? 0))}%`}`,
      summary: [headline, driver].filter(Boolean).join(' '),
      statements: [
        { kind: 'verified', text: `${headline} Comparison: ${ctx.baseline.label.toLowerCase()}.` },
        ...(driver ? [{ kind: 'verified' as const, text: driver }] : []),
        ...(young ? [{ kind: 'estimate' as const, text: 'Only a few days of this period have passed, so this may still change.' }] : []),
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: c.net,
        baselinePaise: b.net,
        changePct: pct,
        txnCount: c.count,
        baselineCount: b.count,
        calculation: [
          `Net spend = purchases − refunds: ${fmt(c.gross)} − ${fmt(c.refunds)} = ${fmt(c.net)}`,
          `Baseline net: ${fmt(b.gross)} − ${fmt(b.refunds)} = ${fmt(b.net)}`,
          `Change = (${fmt(c.net)} − ${fmt(b.net)}) ÷ ${fmt(b.net)} = ${pctText(pct)}`,
        ],
        scope: scope === 'category' ? { category: key } : { platform: key },
      },
      confidence: Math.max(0.3, confidence),
      action: up && discretionary ? `Consider a monthly limit for ${name.toLowerCase()} in Budgets.` : undefined,
    };
  });
}

function frequentSmall(ctx: InsightContext, cur: readonly InsightTxn[]): InsightDraft[] {
  const skip = new Set(['bills', 'rent', 'fees', 'cash', 'subscriptions', 'education', 'health']);
  const expenses = cur.filter((t) => t.type === 'expense');
  const small = expenses.filter((t) => t.amountPaise <= 30_000 && !skip.has(t.category ?? ''));
  const total = small.reduce((s, t) => s + t.amountPaise, 0);
  const all = expenses.reduce((s, t) => s + t.amountPaise, 0);
  if (small.length < 12 || total < 250_000 || all === 0 || total / all < 0.08) return [];
  const monthlyFactor = 30.4375 / Math.max(1, ctx.current.elapsedDays);
  const saving = Math.round(total * 0.2 * monthlyFactor);
  const avg = Math.round(total / small.length);
  return [
    {
      key: `frequent_small_purchases:all:${ctx.current.toDate.slice(0, 7)}`,
      type: 'frequent_small_purchases',
      severity: 'info',
      title: `${small.length} small purchases add up to ${fmt(total)}`,
      summary: `${small.length} purchases of ₹300 or less (average ${fmt(avg)}) came to ${fmt(total)} — ${Math.round((total / all) * 100)}% of your spending in this period.`,
      statements: [
        { kind: 'verified', text: `${small.length} purchases of ₹300 or less totalled ${fmt(total)} (${Math.round((total / all) * 100)}% of spending).` },
        { kind: 'estimate', text: `Trimming a fifth of them would free roughly ${fmt(saving)} a month, if the pattern continues.` },
        { kind: 'suggestion', text: 'Batch small buys into fewer, planned purchases.' },
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: total,
        txnCount: small.length,
        calculation: [
          'Counted expenses of ₹300 or less, excluding bills, rent, fees, cash, subscriptions, education and health',
          `Total = ${fmt(total)}; share = ${fmt(total)} ÷ ${fmt(all)} = ${Math.round((total / all) * 100)}%`,
          `Estimate = 20% × ${fmt(total)} scaled to a 30-day month = ${fmt(saving)}`,
        ],
        transactionIds: small.slice(0, 20).map((t) => t.id),
      },
      confidence: small.length >= 20 ? 0.7 : 0.55,
      estimatedMonthlySavingsPaise: saving,
      action: 'Set a weekly limit for small purchases in Budgets.',
    },
  ];
}

function weekendSpending(ctx: InsightContext, cur: readonly InsightTxn[]): InsightDraft[] {
  if (ctx.current.elapsedDays < 14) return [];
  const discretionary = new Set(DISCRETIONARY_CATEGORY_SLUGS);
  let weekend = 0;
  let weekday = 0;
  for (const t of cur) {
    if (t.type !== 'expense' || !discretionary.has(t.category ?? '')) continue;
    if (localParts(t.date, ctx.tz).weekday >= 6) weekend += t.amountPaise;
    else weekday += t.amountPaise;
  }
  let weekendDays = 0;
  let weekdayDays = 0;
  for (let i = 0; i < ctx.current.elapsedDays; i++) {
    const d = new Date(ctx.current.from.getTime() + i * 86_400_000 + 12 * 3_600_000);
    if (localParts(d, ctx.tz).weekday >= 6) weekendDays++;
    else weekdayDays++;
  }
  if (weekendDays < 4 || weekdayDays < 8) return [];
  const wkEnd = weekend / weekendDays;
  const wkDay = weekday / weekdayDays;
  if (wkEnd < wkDay * 1.4 || wkEnd - wkDay < 30_000) return [];
  const ratio = wkDay > 0 ? wkEnd / wkDay : null;
  return [
    {
      key: `weekend_spending:all:${ctx.current.toDate.slice(0, 7)}`,
      type: 'weekend_spending',
      severity: 'info',
      title: 'Weekends cost you more',
      summary: `You spend about ${fmt(Math.round(wkEnd))} a day on discretionary things at weekends versus ${fmt(Math.round(wkDay))} on weekdays${ratio ? ` (${ratio.toFixed(1)}×)` : ''}.`,
      statements: [
        { kind: 'verified', text: `Discretionary spending averaged ${fmt(Math.round(wkEnd))} per weekend day and ${fmt(Math.round(wkDay))} per weekday.` },
        { kind: 'suggestion', text: 'A fixed weekend budget can keep this in check without cutting the fun.' },
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: weekend,
        baselinePaise: weekday,
        calculation: [
          `Weekend: ${fmt(weekend)} over ${weekendDays} days = ${fmt(Math.round(wkEnd))}/day`,
          `Weekday: ${fmt(weekday)} over ${weekdayDays} days = ${fmt(Math.round(wkDay))}/day`,
          'Only discretionary categories (food delivery, dining, entertainment, shopping, subscriptions, personal care, gifts) are counted',
        ],
      },
      confidence: ctx.current.elapsedDays >= 21 ? 0.7 : 0.55,
      action: 'Create a weekly entertainment/dining limit in Budgets.',
    },
  ];
}

function lateNight(ctx: InsightContext, cur: readonly InsightTxn[]): InsightDraft[] {
  const orderish = new Set(['food-delivery', 'groceries', 'dining-out', 'entertainment', 'shopping']);
  const timed = cur.filter((t) => t.type === 'expense' && t.hasTime && orderish.has(t.category ?? ''));
  const late = timed.filter((t) => {
    const h = localParts(t.date, ctx.tz).hour;
    return h >= 23 || h < 4;
  });
  if (late.length < 3) return [];
  const total = late.reduce((s, t) => s + t.amountPaise, 0);
  return [
    {
      key: `late_night_orders:all:${ctx.current.toDate.slice(0, 7)}`,
      type: 'late_night_orders',
      severity: 'info',
      title: `${late.length} late-night orders`,
      summary: `${late.length} orders between 11 pm and 4 am came to ${fmt(total)} (average ${fmt(Math.round(total / late.length))}).`,
      statements: [
        { kind: 'verified', text: `${late.length} of ${timed.length} timestamped orders were placed between 11 pm and 4 am, totalling ${fmt(total)}.` },
        { kind: 'suggestion', text: 'Keeping simple snacks at home is the usual fix for late-night ordering.' },
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: total,
        txnCount: late.length,
        calculation: [
          'Only transactions with a recorded time of day are considered',
          `${late.length} of ${timed.length} timestamped orders fall between 23:00 and 04:00 (${ctx.tz})`,
        ],
        transactionIds: late.slice(0, 20).map((t) => t.id),
      },
      confidence: 0.8,
    },
  ];
}

function discretionaryTrend(ctx: InsightContext): InsightDraft[] {
  const m = ctx.monthlyDiscretionaryPaise.slice(-3);
  if (m.length < 3) return [];
  const [a, b, c] = m as [number, number, number];
  if (!(a < b && b < c) || a <= 0 || c / a - 1 < 0.15 || c < 300_000) return [];
  const growth = Math.round((c / a - 1) * 100);
  return [
    {
      key: `discretionary_trend:all:${ctx.current.toDate.slice(0, 7)}`,
      type: 'discretionary_trend',
      severity: 'warning',
      title: 'Discretionary spending keeps rising',
      summary: `Discretionary spending rose three months in a row: ${fmt(a)} → ${fmt(b)} → ${fmt(c)} (+${growth}%).`,
      statements: [{ kind: 'verified', text: `Monthly discretionary spend: ${fmt(a)}, ${fmt(b)}, ${fmt(c)} (last three complete months).` }],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: c,
        baselinePaise: a,
        changePct: (c / a - 1) * 100,
        calculation: [`Growth over three months = (${fmt(c)} − ${fmt(a)}) ÷ ${fmt(a)} = +${growth}%`],
      },
      confidence: 0.75,
      action: 'Review your top discretionary categories and set limits.',
    },
  ];
}

function repeatedPurchases(ctx: InsightContext, cur: readonly InsightTxn[]): InsightDraft[] {
  const recurringKeys = new Set(ctx.recurring.map((r) => r.merchantKey));
  const groups = new Map<string, InsightTxn[]>();
  for (const t of cur) {
    if (t.type !== 'expense' || t.amountPaise < 10_000 || recurringKeys.has(t.merchantKey)) continue;
    const k = `${t.merchantKey}|${t.amountPaise}`;
    const list = groups.get(k);
    if (list) list.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 4)
    .sort((a, b) => b.length * (b[0] as InsightTxn).amountPaise - a.length * (a[0] as InsightTxn).amountPaise)
    .slice(0, 2)
    .map((g) => {
      const first = g[0] as InsightTxn;
      const total = g.length * first.amountPaise;
      return {
        key: `repeated_purchases:${first.merchantKey}:${ctx.current.toDate.slice(0, 7)}`,
        type: 'repeated_purchases' as const,
        severity: 'info' as const,
        title: `${first.merchantName} ${g.length}× at ${fmt(first.amountPaise)}`,
        summary: `You paid ${first.merchantName} exactly ${fmt(first.amountPaise)} ${g.length} times, ${fmt(total)} in total.`,
        statements: [
          { kind: 'verified' as const, text: `${g.length} identical payments of ${fmt(first.amountPaise)} to ${first.merchantName} (${fmt(total)}).` },
          { kind: 'suggestion' as const, text: 'If this is a routine purchase, a bundle or subscription may cost less — worth checking.' },
        ],
        evidence: {
          ...evidenceBase(ctx),
          amountPaise: total,
          txnCount: g.length,
          calculation: [`${g.length} × ${fmt(first.amountPaise)} = ${fmt(total)}`],
          transactionIds: g.map((t) => t.id),
        },
        confidence: 0.7,
      };
    });
}

function anomalies(ctx: InsightContext, history: readonly InsightTxn[]): InsightDraft[] {
  const byCategory = new Map<string, InsightTxn[]>();
  for (const t of history) {
    if (t.type !== 'expense' || !t.category || ['rent', 'bills', 'education'].includes(t.category)) continue;
    const list = byCategory.get(t.category);
    if (list) list.push(t);
    else byCategory.set(t.category, [t]);
  }
  const flagged: Array<{ t: InsightTxn; med: number; p25: number; p75: number }> = [];
  for (const [, rows] of byCategory) {
    if (rows.length < 8) continue;
    const amounts = rows.map((r) => r.amountPaise).sort((a, b) => a - b);
    const med = medianPaise(amounts);
    const mad = medianPaise(amounts.map((a) => Math.abs(a - med)));
    const spread = Math.max(mad, med * 0.1);
    const p25 = amounts[Math.floor(amounts.length * 0.25)] as number;
    const p75 = amounts[Math.floor(amounts.length * 0.75)] as number;
    for (const t of rows) {
      if (t.date < ctx.current.from || t.date >= ctx.current.to) continue;
      if (t.amountPaise >= med + 6 * spread && t.amountPaise >= 2.5 * med && t.amountPaise >= 100_000) {
        flagged.push({ t, med, p25, p75 });
      }
    }
  }
  return flagged
    .sort((a, b) => b.t.amountPaise - a.t.amountPaise)
    .slice(0, 3)
    .map(({ t, med, p25, p75 }) => ({
      key: `unusual_transaction:${t.id}`,
      type: 'unusual_transaction' as const,
      severity: 'warning' as const,
      title: `Unusually large: ${t.merchantName}`,
      summary: `${fmt(t.amountPaise)} at ${t.merchantName} is much higher than your typical ${categoryName(t.category)} purchase (usually ${fmt(p25)}–${fmt(p75)}).`,
      statements: [
        { kind: 'verified' as const, text: `${fmt(t.amountPaise)} at ${t.merchantName}; your typical ${categoryName(t.category).toLowerCase()} purchase is about ${fmt(med)}.` },
        { kind: 'suggestion' as const, text: 'If you do not recognise it, check it against your statement.' },
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: t.amountPaise,
        baselinePaise: med,
        calculation: [
          `Median ${categoryName(t.category)} purchase: ${fmt(med)}; typical range ${fmt(p25)}–${fmt(p75)}`,
          'Flagged because it is at least 2.5× the median and far outside the usual spread',
        ],
        transactionIds: [t.id],
        scope: { category: t.category ?? undefined },
      },
      confidence: 0.65,
    }));
}

function possibleDuplicates(ctx: InsightContext, cur: readonly InsightTxn[]): InsightDraft[] {
  const groups = new Map<string, InsightTxn[]>();
  for (const t of cur) {
    if (t.type !== 'expense' || t.amountPaise < 10_000) continue;
    const k = `${t.merchantKey}|${t.amountPaise}`;
    const list = groups.get(k);
    if (list) list.push(t);
    else groups.set(k, [t]);
  }
  const found: Array<[InsightTxn, InsightTxn]> = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as InsightTxn;
      const b = sorted[i] as InsightTxn;
      const close = a.hasTime && b.hasTime && b.date.getTime() - a.date.getTime() <= 10 * 60_000;
      const sameDay = localParts(a.date, ctx.tz).dateKey === localParts(b.date, ctx.tz).dateKey;
      const foodLike = ['food-delivery', 'groceries', 'dining-out', 'transport'].includes(a.category ?? '');
      if (close || (sameDay && !foodLike && a.amountPaise >= 50_000)) found.push([a, b]);
    }
  }
  return found.slice(0, 4).map(([a, b]) => ({
    key: `possible_duplicate:${a.id}:${b.id}`,
    type: 'possible_duplicate' as const,
    severity: 'warning' as const,
    title: `Possible double charge at ${a.merchantName}`,
    summary: `Two payments of ${fmt(a.amountPaise)} to ${a.merchantName} were made ${a.hasTime && b.hasTime && b.date.getTime() - a.date.getTime() <= 600_000 ? 'within 10 minutes' : 'on the same day'}.`,
    statements: [
      { kind: 'verified' as const, text: `Two identical ${fmt(a.amountPaise)} charges at ${a.merchantName} close together.` },
      { kind: 'suggestion' as const, text: 'Check your statement; if one is a duplicate, ask the merchant for a refund.' },
    ],
    evidence: {
      ...evidenceBase(ctx),
      amountPaise: a.amountPaise * 2,
      txnCount: 2,
      calculation: ['Same merchant and amount, recorded close together'],
      transactionIds: [a.id, b.id],
    },
    confidence: 0.6,
    action: 'Review both transactions.',
  }));
}

function subscriptionReview(ctx: InsightContext): InsightDraft[] {
  const sixMonthsAgo = ctx.now.getTime() - 183 * 86_400_000;
  return ctx.recurring
    .filter((r) => r.confidence >= 0.55 && !r.possiblyInactive)
    .filter((r) => r.annualCostPaise >= 120_000 || r.priceChanges.some((p) => p.date.getTime() >= sixMonthsAgo))
    .sort((a, b) => b.annualCostPaise - a.annualCostPaise)
    .slice(0, 3)
    .map((r) => {
      const change = r.priceChanges[r.priceChanges.length - 1];
      return {
        key: `subscription_review:${r.merchantKey}:${ctx.current.toDate.slice(0, 7)}`,
        type: 'subscription_review' as const,
        severity: 'info' as const,
        title: `Review ${r.displayName}`,
        summary: `${r.displayName} costs about ${fmt(r.annualCostPaise)} a year (${fmt(r.monthlyCostPaise)}/month equivalent).${change ? ` The price changed from ${fmt(change.fromPaise)} to ${fmt(change.toPaise)}.` : ''}`,
        statements: [
          { kind: 'verified' as const, text: `${r.occurrences} charges roughly every ${r.intervalDays} days; latest ${fmt(r.lastAmountPaise)}.` },
          ...(change ? [{ kind: 'verified' as const, text: `Price changed from ${fmt(change.fromPaise)} to ${fmt(change.toPaise)}.` }] : []),
          { kind: 'estimate' as const, text: `At this rate it costs about ${fmt(r.annualCostPaise)} per year (detection confidence ${Math.round(r.confidence * 100)}%).` },
          { kind: 'suggestion' as const, text: 'Decide whether you still use it. Spendly cannot cancel it or check cancellation terms for you.' },
        ],
        evidence: {
          ...evidenceBase(ctx),
          amountPaise: r.annualCostPaise,
          txnCount: r.occurrences,
          calculation: [`${fmt(r.amountPaise)} × (365 ÷ ${r.intervalDays} days) ≈ ${fmt(r.annualCostPaise)} per year`, ...r.reasons],
          scope: { category: r.category ?? undefined, platform: r.platform ?? undefined },
        },
        confidence: r.confidence,
        action: 'Open Recurring payments to confirm or dismiss it.',
      };
    });
}

function savingsOpportunities(ctx: InsightContext): InsightDraft[] {
  const rows = Object.entries(ctx.avgMonthlyByCategory)
    .filter(([slug, v]) => DISCRETIONARY_CATEGORY_SLUGS.includes(slug) && v.avgPaise >= 150_000 && v.months >= 2)
    .sort((a, b) => b[1].avgPaise - a[1].avgPaise)
    .slice(0, 3);
  const tips: Record<string, string> = {
    'food-delivery': 'Set a weekly cap on delivery orders and cook or pick up on a couple of those days.',
    'dining-out': 'Pick a monthly dining-out limit and spend it on the meals you enjoy most.',
    entertainment: 'Set a monthly entertainment limit; compare ticket prices across platforms before booking.',
    shopping: 'Add a 48-hour wait before non-essential purchases.',
    subscriptions: 'Review which services you actually used this month.',
    'personal-care': 'Compare plans or memberships against how often you go.',
    gifts: 'Plan gift spending around the occasions you know are coming.',
  };
  return rows.map(([slug, v]) => {
    const saving = Math.round(v.avgPaise * 0.2);
    const stable = v.months >= 3 && v.cv <= 0.35;
    return {
      key: `savings_opportunity:${slug}:${ctx.current.toDate.slice(0, 7)}`,
      type: 'savings_opportunity' as const,
      severity: 'info' as const,
      title: `Trim ${categoryName(slug).toLowerCase()} by 20%`,
      summary: `You average ${fmt(v.avgPaise)} a month on ${categoryName(slug).toLowerCase()}. A 20% cut would free about ${fmt(saving)} a month (${fmt(saving * 12)} a year).`,
      statements: [
        { kind: 'verified' as const, text: `Average ${categoryName(slug).toLowerCase()} spending over the last ${v.months} complete months: ${fmt(v.avgPaise)} a month.` },
        { kind: 'estimate' as const, text: `A 20% reduction ≈ ${fmt(saving)} a month, ${fmt(saving * 12)} a year, if your pattern stays the same.` },
        { kind: 'suggestion' as const, text: tips[slug] ?? 'Set a monthly limit and track it in Budgets.' },
      ],
      evidence: {
        ...evidenceBase(ctx),
        amountPaise: v.avgPaise,
        calculation: [`20% × ${fmt(v.avgPaise)} = ${fmt(saving)} per month`, `${fmt(saving)} × 12 = ${fmt(saving * 12)} per year`],
        scope: { category: slug },
      },
      confidence: stable ? 0.7 : 0.5,
      estimatedMonthlySavingsPaise: saving,
      action: tips[slug] ?? 'Set a monthly limit in Budgets.',
    };
  });
}

/**
 * Runs every detector. `rows` must cover the baseline start through the current period end.
 */
export function generateInsights(ctx: InsightContext, rows: readonly InsightTxn[]): InsightDraft[] {
  const cur = within(rows, ctx.current);
  const base = within(rows, ctx.baseline);
  return [
    ...changes(ctx, cur, base, 'category', 3),
    ...changes(ctx, cur, base, 'platform', 2),
    ...frequentSmall(ctx, cur),
    ...weekendSpending(ctx, cur),
    ...lateNight(ctx, cur),
    ...discretionaryTrend(ctx),
    ...repeatedPurchases(ctx, cur),
    ...anomalies(ctx, rows),
    ...possibleDuplicates(ctx, cur),
    ...subscriptionReview(ctx),
    ...savingsOpportunities(ctx),
  ];
}

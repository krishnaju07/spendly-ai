import { DateTime } from 'luxon';
import {
  COACH_DISCLAIMER,
  customRange,
  formatINR,
  generateInsights,
  percentChange,
  previousPeriod,
  resolveRange,
  share,
  type CoachAnswer,
  type CoachBreakdownRow,
  type CoachMetric,
  type PeriodSpec,
  type QueryPlan,
  type ResolvedRange,
  type SpendFilter,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { categoryStats, dataCoverage, netSpend, periodTotals, platformStats } from './analytics';
import { listBudgetDtos } from './budgets';
import { buildInsightContext, listInsights } from './insights';
import type { Lookups } from './lookups';
import { recurringSummary } from './recurring';

const money = (p: number) => formatINR(p, { decimals: Math.abs(p) >= 100_000 ? 'never' : 'auto' });
const pct = (v: number | null) => (v === null ? 'no comparison available' : Math.round(v) === 0 ? 'unchanged' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`);
const dateFmt = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat('d LLL yyyy');

export function resolveSpec(spec: PeriodSpec, auth: AuthContext, now: Date): ResolvedRange {
  const opts = { weekStartsOn: auth.weekStartsOn };
  const today = DateTime.fromJSDate(now, { zone: auth.tz }).startOf('day');
  switch (spec.kind) {
    case 'preset':
      return resolveRange({ preset: spec.preset }, auth.tz, now, opts);
    case 'range':
      return customRange(spec.from, spec.to, auth.tz, now);
    case 'last_days': {
      const r = customRange(today.minus({ days: spec.days - 1 }).toISODate() as string, today.toISODate() as string, auth.tz, now);
      return { ...r, label: `Last ${spec.days} days`, unit: null };
    }
    case 'last_months': {
      const from = today.minus({ months: spec.months }).plus({ days: 1 });
      const r = customRange(from.toISODate() as string, today.toISODate() as string, auth.tz, now);
      return { ...r, label: `Last ${spec.months} month${spec.months === 1 ? '' : 's'}`, unit: null };
    }
    case 'month': {
      const start = DateTime.fromFormat(spec.month, 'yyyy-LL', { zone: auth.tz });
      return customRange(start.toISODate() as string, start.endOf('month').toISODate() as string, auth.tz, now);
    }
  }
}

function phrase(r: ResolvedRange): string {
  switch (r.preset) {
    case 'this_month':
      return 'so far this month';
    case 'last_month':
      return 'last month';
    case 'this_week':
      return 'this week';
    case 'last_week':
      return 'last week';
    case 'today':
      return 'today';
    case 'yesterday':
      return 'yesterday';
    case 'this_year':
      return 'so far this year';
    case 'last_year':
      return 'last year';
    default:
      return r.unit === 'month' && r.preset === 'custom'
        ? `in ${DateTime.fromISO(r.fromDate, { zone: r.timezone }).toFormat('LLLL yyyy')}`
        : r.label.toLowerCase().startsWith('last ')
          ? `in the ${r.label.toLowerCase()}`
          : `(${r.label})`;
  }
}

const rangeInfo = (r: ResolvedRange) => ({ label: r.label, from: r.fromDate, to: r.toDate });

function filterLabel(f: SpendFilter): string {
  return f.label && f.label !== 'everything' ? f.label : 'everything';
}

function transactionsHref(range: ResolvedRange, f?: SpendFilter): string {
  const q = new URLSearchParams({ from: range.fromDate, to: range.toDate });
  if (f?.categories?.length) q.set('category', f.categories.join(','));
  if (f?.platforms?.length) q.set('platform', f.platforms.join(','));
  return `/transactions?${q.toString()}`;
}

type Coverage = NonNullable<Awaited<ReturnType<typeof dataCoverage>>>;

function assess(
  auth: AuthContext,
  range: ResolvedRange | null,
  cov: Coverage | null,
  count: number,
): { coverage: CoachAnswer['coverage']; confidence: CoachAnswer['confidence'] } {
  const notes: string[] = [];
  let level: 'high' | 'medium' | 'low' = 'high';
  let reason = 'Based on all matching transactions in the period.';
  if (!cov || cov.count === 0) {
    level = 'low';
    reason = 'There are no transactions on record yet.';
  } else {
    if (range && cov.first.getTime() > range.from.getTime() + 7 * 86_400_000) {
      notes.push(`Your records start on ${dateFmt(cov.first, auth.tz)}, after the beginning of this period — earlier spending is not included.`);
      level = 'medium';
      reason = 'Your transaction history does not cover the whole period.';
    }
    if (range?.inProgress) notes.push(`This period is still in progress (day ${range.elapsedDays} of ${range.days}).`);
    if (count > 0 && count < 3) {
      level = 'low';
      reason = `Only ${count} matching transaction${count === 1 ? '' : 's'}, so patterns are not reliable.`;
    }
    const unc = cov.count > 0 ? (cov.uncategorized / cov.count) * 100 : 0;
    if (unc > 20) {
      notes.push(`${Math.round(unc)}% of your transactions are uncategorized, which can understate category totals.`);
      if (level === 'high') {
        level = 'medium';
        reason = 'Many transactions are still uncategorized.';
      }
    }
  }
  if (auth.user.isDemo) notes.push('This is demo data, not your real spending.');
  return {
    coverage: {
      firstTransactionDate: cov ? DateTime.fromJSDate(cov.first, { zone: auth.tz }).toISODate() : null,
      lastTransactionDate: cov ? DateTime.fromJSDate(cov.last, { zone: auth.tz }).toISODate() : null,
      transactionsConsidered: count,
      uncategorizedSharePct: cov && cov.count > 0 ? Math.round((cov.uncategorized / cov.count) * 1000) / 10 : null,
      isDemo: auth.user.isDemo,
      notes,
    },
    confidence: { level, reason },
  };
}

interface Draft {
  headline: string;
  period?: ResolvedRange | null;
  baseline?: ResolvedRange | null;
  metrics?: CoachMetric[];
  breakdown?: CoachBreakdownRow[];
  calculation?: string[];
  statements?: CoachAnswer['statements'];
  count?: number;
  nextAction?: CoachAnswer['nextAction'];
  href?: string;
  confidenceOverride?: Partial<CoachAnswer['confidence']>;
  extraNotes?: string[];
  /** Skip coverage checks against the period (e.g. help, budgets). */
  rangeForCoverage?: ResolvedRange | null;
}

const metric = (key: string, label: string, kind: 'verified' | 'estimate', display: string, extra: Partial<CoachMetric> = {}): CoachMetric => ({
  key,
  label,
  kind,
  display,
  ...extra,
});

function finish(
  auth: AuthContext,
  question: string,
  plan: QueryPlan,
  assumptions: string[],
  cov: Coverage | null,
  d: Draft,
): CoachAnswer {
  const a = assess(auth, d.rangeForCoverage === undefined ? (d.period ?? null) : d.rangeForCoverage, cov, d.count ?? 0);
  const verified = (d.statements ?? []).filter((s) => s.kind === 'verified').slice(0, 2).map((s) => s.text);
  return {
    question,
    plan,
    headline: d.headline,
    period: d.period ? rangeInfo(d.period) : null,
    baseline: d.baseline ? rangeInfo(d.baseline) : null,
    metrics: d.metrics ?? [],
    breakdown: d.breakdown ?? [],
    calculation: d.calculation ?? [],
    coverage: { ...a.coverage, notes: [...a.coverage.notes, ...(d.extraNotes ?? [])] },
    confidence: { ...a.confidence, ...d.confidenceOverride },
    statements: d.statements ?? [],
    nextAction: d.nextAction,
    assumptions,
    transactionsHref: d.href,
    explanation: { source: 'deterministic', text: [d.headline, ...verified].join(' ') },
    disclaimer: COACH_DISCLAIMER,
  };
}

const rowsFromStats = (
  stats: Array<{ slug: string | null; name: string; netPaise: number; count: number; changePct: number | null }>,
  total: number,
  limit: number,
): CoachBreakdownRow[] =>
  stats.slice(0, limit).map((s) => ({
    slug: s.slug ?? undefined,
    label: s.name,
    paise: s.netPaise,
    display: money(s.netPaise),
    count: s.count,
    sharePct: share(Math.max(0, s.netPaise), total),
    changePct: s.changePct,
  }));

/** Executes a validated query plan and assembles a fully evidenced answer from database facts only. */
export async function answerPlan(
  auth: AuthContext,
  lk: Lookups,
  question: string,
  plan: QueryPlan,
  assumptions: string[],
  now = new Date(),
): Promise<CoachAnswer> {
  const cov = await dataCoverage(auth);
  const done = (d: Draft) => finish(auth, question, plan, assumptions, cov, d);

  switch (plan.intent) {
    case 'spend_total': {
      const range = resolveSpec(plan.period, auth, now);
      const baseline = previousPeriod(range, now);
      const scope = { categories: plan.filter.categories, platforms: plan.filter.platforms };
      const [cur, prev] = await Promise.all([netSpend(auth, range, scope), netSpend(auth, baseline, scope)]);
      const label = filterLabel(plan.filter);
      const change = percentChange(cur.netPaise, prev.netPaise);
      const avg = cur.count ? Math.round(cur.grossPaise / cur.count) : 0;

      let breakdown: CoachBreakdownRow[] = [];
      if (cur.count > 0) {
        if (scope.categories?.length) {
          const ps = await platformStats(auth, lk, range, baseline, { category: scope.categories });
          breakdown = rowsFromStats(ps, cur.netPaise, 6);
        } else {
          const cs = await categoryStats(auth, lk, range, baseline, scope.platforms ? { platform: scope.platforms } : undefined);
          breakdown = rowsFromStats(cs, cur.netPaise, 6);
        }
      }
      const calc = [`Net spending = purchases − refunds = ${money(cur.grossPaise)} − ${money(cur.refundsPaise)} = ${money(cur.netPaise)}`];
      if (cur.count) calc.push(`Average per transaction = ${money(cur.grossPaise)} ÷ ${cur.count} = ${money(avg)}`);
      if (prev.netPaise > 0) calc.push(`Change = (${money(cur.netPaise)} − ${money(prev.netPaise)}) ÷ ${money(prev.netPaise)} = ${pct(change)}`);

      return done({
        headline:
          cur.count === 0
            ? `I found no ${label === 'everything' ? 'spending' : `${label} spending`} ${phrase(range)}.`
            : `You spent ${money(cur.netPaise)}${label === 'everything' ? '' : ` on ${label}`} ${phrase(range)}${cur.refundsPaise > 0 ? ` (after ${money(cur.refundsPaise)} of refunds)` : ''}.`,
        period: range,
        baseline,
        count: cur.count,
        breakdown,
        calculation: calc,
        metrics: [
          metric('net', 'Net spending', 'verified', money(cur.netPaise), { paise: cur.netPaise }),
          metric('gross', 'Purchases', 'verified', money(cur.grossPaise), { paise: cur.grossPaise }),
          ...(cur.refundsPaise > 0 ? [metric('refunds', 'Refunds', 'verified', money(cur.refundsPaise), { paise: cur.refundsPaise })] : []),
          metric('count', 'Transactions', 'verified', String(cur.count), { value: cur.count }),
          ...(cur.count ? [metric('avg', 'Average each', 'verified', money(avg), { paise: avg })] : []),
          metric('baseline', baseline.baselineLabel, 'verified', money(prev.netPaise), { paise: prev.netPaise }),
        ],
        statements: [
          { kind: 'verified', text: `${money(cur.netPaise)} across ${cur.count} transaction${cur.count === 1 ? '' : 's'}.` },
          ...(prev.netPaise > 0 || cur.netPaise > 0
            ? [{ kind: 'verified' as const, text: `${baseline.baselineLabel}: ${money(prev.netPaise)} (${pct(change)}).` }]
            : []),
        ],
        href: transactionsHref(range, plan.filter),
        nextAction: { label: 'See the transactions', href: transactionsHref(range, plan.filter) },
      });
    }

    case 'top_categories':
    case 'top_platforms': {
      const range = resolveSpec(plan.period, auth, now);
      const baseline = previousPeriod(range, now);
      const stats =
        plan.intent === 'top_categories' ? await categoryStats(auth, lk, range, baseline) : await platformStats(auth, lk, range, baseline);
      const total = stats.reduce((s, r) => s + Math.max(0, r.netPaise), 0);
      const top = stats.filter((s) => s.netPaise > 0).slice(0, plan.limit);
      const noun = plan.intent === 'top_categories' ? 'categories' : 'platforms';
      const lead = top[0];
      const one = plan.intent === 'top_categories' ? 'category' : 'platform';
      return done({
        headline: lead
          ? `${lead.name} is your biggest ${one} ${phrase(range)}: ${money(lead.netPaise)}${total ? ` (${Math.round((lead.netPaise / total) * 100)}% of ${money(total)})` : ''}. Here are your top ${top.length} ${noun}.`
          : `I found no spending ${phrase(range)}.`,
        period: range,
        baseline,
        count: stats.reduce((s, r) => s + r.count, 0),
        breakdown: rowsFromStats(top, total, plan.limit),
        calculation: [`Each total is purchases minus refunds; shares are out of ${money(total)} of net spending.`],
        metrics: [metric('total', 'Net spending', 'verified', money(total), { paise: total })],
        statements: top.slice(0, 3).map((s) => ({
          kind: 'verified' as const,
          text: `${s.name}: ${money(s.netPaise)} (${pct(s.changePct)} vs ${baseline.baselineLabel.toLowerCase()}).`,
        })),
        href: transactionsHref(range),
        nextAction: { label: 'Open analytics', href: '/analytics' },
      });
    }

    case 'compare_platforms': {
      const range = resolveSpec(plan.period, auth, now);
      const [a, b] = plan.platforms as [string, string];
      const [ra, rb] = await Promise.all([netSpend(auth, range, { platforms: [a] }), netSpend(auth, range, { platforms: [b] })]);
      const na = lk.platformName(a) ?? a;
      const nb = lk.platformName(b) ?? b;
      const avgA = ra.count ? Math.round(ra.grossPaise / ra.count) : 0;
      const avgB = rb.count ? Math.round(rb.grossPaise / rb.count) : 0;
      const higherTotal = ra.netPaise === rb.netPaise ? null : ra.netPaise > rb.netPaise ? na : nb;
      const higherAvg = avgA === avgB || !ra.count || !rb.count ? null : avgA > avgB ? na : nb;
      return done({
        headline:
          ra.count + rb.count === 0
            ? `I found no ${na} or ${nb} spending ${phrase(range)}.`
            : `${phrase(range)[0]?.toUpperCase()}${phrase(range).slice(1)}, ${na} cost you ${money(ra.netPaise)} over ${ra.count} order${ra.count === 1 ? '' : 's'} (average ${money(avgA)}) and ${nb} cost ${money(rb.netPaise)} over ${rb.count} (average ${money(avgB)}).${higherTotal && higherTotal === higherAvg ? ` ${higherTotal} is higher both in total and per order.` : `${higherTotal ? ` ${higherTotal} is higher in total` : ''}${higherAvg ? `${higherTotal ? ', while ' : ' '}${higherAvg} is higher per order` : ''}${higherTotal || higherAvg ? '.' : ''}`}`,
        period: range,
        count: ra.count + rb.count,
        breakdown: [
          { slug: a, label: na, paise: ra.netPaise, display: money(ra.netPaise), count: ra.count },
          { slug: b, label: nb, paise: rb.netPaise, display: money(rb.netPaise), count: rb.count },
        ],
        calculation: [`${na}: ${money(ra.grossPaise)} − ${money(ra.refundsPaise)} refunds = ${money(ra.netPaise)}; ${money(ra.grossPaise)} ÷ ${ra.count} orders = ${money(avgA)} average`, `${nb}: ${money(rb.grossPaise)} − ${money(rb.refundsPaise)} refunds = ${money(rb.netPaise)}; ${money(rb.grossPaise)} ÷ ${rb.count} orders = ${money(avgB)} average`],
        metrics: [
          metric('a', `${na} total`, 'verified', money(ra.netPaise), { paise: ra.netPaise }),
          metric('b', `${nb} total`, 'verified', money(rb.netPaise), { paise: rb.netPaise }),
          metric('avgA', `${na} average order`, 'verified', money(avgA), { paise: avgA }),
          metric('avgB', `${nb} average order`, 'verified', money(avgB), { paise: avgB }),
        ],
        statements: [
          { kind: 'verified', text: `${na}: ${ra.count} orders, ${money(ra.netPaise)}. ${nb}: ${rb.count} orders, ${money(rb.netPaise)}.` },
          { kind: 'suggestion', text: 'Averages reflect what you ordered each time, not the platforms’ prices — compare the same items before switching.' },
        ],
        href: transactionsHref(range, { platforms: [a, b] }),
        nextAction: { label: 'See both on the Platforms page', href: '/platforms' },
      });
    }

    case 'share_of_spend': {
      const range = resolveSpec(plan.period, auth, now);
      const scope = { categories: plan.filter.categories, platforms: plan.filter.platforms };
      const [part, whole] = await Promise.all([netSpend(auth, range, scope), netSpend(auth, range)]);
      const share_ = share(part.netPaise, whole.netPaise);
      const label = filterLabel(plan.filter);
      const cs = await categoryStats(auth, lk, range, previousPeriod(range, now));
      return done({
        headline:
          share_ === null
            ? `I found no spending ${phrase(range)}, so there is no share to calculate.`
            : `${label[0]?.toUpperCase()}${label.slice(1)} made up ${share_.toFixed(1)}% of your spending ${phrase(range)} (${money(part.netPaise)} of ${money(whole.netPaise)}).`,
        period: range,
        count: part.count,
        breakdown: rowsFromStats(cs, whole.netPaise, 6),
        calculation: [`Share = ${money(part.netPaise)} ÷ ${money(whole.netPaise)} = ${share_ === null ? 'n/a' : `${share_.toFixed(1)}%`}`],
        metrics: [
          metric('part', label, 'verified', money(part.netPaise), { paise: part.netPaise }),
          metric('whole', 'All spending', 'verified', money(whole.netPaise), { paise: whole.netPaise }),
          ...(share_ !== null ? [metric('share', 'Share of spending', 'verified', `${share_.toFixed(1)}%`, { value: share_ })] : []),
        ],
        statements: [{ kind: 'verified', text: `${money(part.netPaise)} of ${money(whole.netPaise)} net spending went to ${label}.` }],
        href: transactionsHref(range, plan.filter),
      });
    }

    case 'what_changed': {
      const range = resolveSpec(plan.period, auth, now);
      const baseline = previousPeriod(range, now);
      const [totals, { ctx, rows }] = await Promise.all([periodTotals(auth, range, baseline), buildInsightContext(auth, lk, now, range)]);
      const movers = generateInsights(ctx, rows).filter((d) => d.type === 'category_change' || d.type === 'platform_change').slice(0, 5);
      const change = percentChange(totals.current.netPaise, totals.previous.netPaise);
      const dir = (change ?? 0) >= 0 ? 'up' : 'down';
      return done({
        headline:
          totals.previous.netPaise === 0
            ? `You spent ${money(totals.current.netPaise)} ${phrase(range)}; there is no earlier spending to compare with.`
            : `Your spending is ${dir} ${Math.abs(Math.round(change ?? 0))}% ${phrase(range)}: ${money(totals.current.netPaise)} versus ${money(totals.previous.netPaise)} (${baseline.baselineLabel.toLowerCase()}).${movers.length ? ` Biggest movers: ${movers.slice(0, 3).map((m) => m.title.replace(' spending', '')).join('; ')}.` : ''}`,
        period: range,
        baseline,
        count: totals.current.expenseCount,
        breakdown: movers.map((m) => ({
          slug: m.evidence.scope?.category ?? m.evidence.scope?.platform,
          label: m.title,
          paise: m.evidence.amountPaise ?? 0,
          display: money(m.evidence.amountPaise ?? 0),
          count: m.evidence.txnCount,
          changePct: m.evidence.changePct ?? null,
        })),
        calculation: [`Net spending now: ${money(totals.current.netPaise)}; before: ${money(totals.previous.netPaise)}`, `Change = ${pct(change)}`, ...movers.slice(0, 2).flatMap((m) => m.evidence.calculation.slice(0, 1))],
        metrics: [
          metric('now', phrase(range), 'verified', money(totals.current.netPaise), { paise: totals.current.netPaise }),
          metric('before', baseline.baselineLabel, 'verified', money(totals.previous.netPaise), { paise: totals.previous.netPaise }),
        ],
        statements: movers.flatMap((m) => m.statements.filter((s) => s.kind === 'verified').slice(0, 2)),
        href: transactionsHref(range),
        nextAction: { label: 'Open analytics to explore', href: '/analytics' },
      });
    }

    case 'what_if_reduce': {
      const months = [1, 2, 3].map((i) => {
        const start = DateTime.fromJSDate(now, { zone: auth.tz }).startOf('month').minus({ months: i });
        return { from: start.toUTC().toJSDate(), to: start.plus({ months: 1 }).toUTC().toJSDate() };
      });
      const scope = { categories: plan.filter.categories, platforms: plan.filter.platforms };
      const totals = await Promise.all(months.map((m) => netSpend(auth, m, scope)));
      const active = totals.map((t) => t.netPaise).filter((v) => v > 0);
      const label = filterLabel(plan.filter);
      const avg = active.length ? Math.round(active.reduce((a, b) => a + b, 0) / active.length) : 0;
      const saving = Math.round((avg * plan.percent) / 100);
      const horizon = saving * plan.horizonMonths;
      const mean = avg || 1;
      const cv = active.length > 1 ? Math.sqrt(active.reduce((a, b) => a + (b - mean) ** 2, 0) / active.length) / mean : 1;
      const level = active.length >= 3 && cv <= 0.35 ? 'medium' : 'low';
      const span = plan.horizonMonths === 12 ? 'a year' : `${plan.horizonMonths} month${plan.horizonMonths === 1 ? '' : 's'}`;
      return done({
        headline:
          avg === 0
            ? `I found no ${label} spending in the last three complete months, so cutting it would not save anything.`
            : `Cutting ${label} by ${plan.percent}% could save about ${money(saving)} a month — roughly ${money(horizon)} over ${span} (an estimate).`,
        period: null,
        rangeForCoverage: null,
        count: totals.reduce((s, t) => s + t.count, 0),
        calculation: [
          `Average ${label} spending over ${active.length} complete month${active.length === 1 ? '' : 's'}: ${money(avg)} a month`,
          `${plan.percent}% × ${money(avg)} = ${money(saving)} a month`,
          `${money(saving)} × ${plan.horizonMonths} months = ${money(horizon)}`,
        ],
        metrics: [
          metric('avg', `Average ${label} per month`, 'verified', money(avg), { paise: avg }),
          metric('saving', 'Estimated monthly saving', 'estimate', money(saving), { paise: saving }),
          metric('total', `Estimated saving over ${span}`, 'estimate', money(horizon), { paise: horizon }),
        ],
        statements: [
          { kind: 'verified', text: `Your average ${label} spending over the last ${active.length} complete month${active.length === 1 ? '' : 's'} is ${money(avg)} a month.` },
          { kind: 'estimate', text: `A ${plan.percent}% reduction would save about ${money(saving)} a month, or ${money(horizon)} over ${span}, if your spending stays at this level.` },
          { kind: 'suggestion', text: 'Setting a monthly budget for this is an easy way to hold yourself to it.' },
        ],
        confidenceOverride: {
          level: avg === 0 ? 'low' : level,
          reason: active.length >= 3 && cv <= 0.35 ? 'Your spending here has been steady over three months.' : 'Based on limited or uneven history, so treat this as a rough guide.',
        },
        nextAction: { label: 'Create a budget for it', href: '/budgets' },
      });
    }

    case 'subscriptions_review': {
      const summary = await recurringSummary(auth, lk, now);
      const obligations = new Set(['rent', 'bills', 'health', 'education']);
      const live = summary.items.filter((i) => i.status !== 'dismissed' && i.confidence >= 0.55 && !obligations.has(i.category ?? '')).sort((a, b) => b.annualCostPaise - a.annualCostPaise);
      const annual = live.reduce((s, i) => s + i.annualCostPaise, 0);
      return done({
        headline: live.length
          ? `I found ${live.length} recurring payment${live.length === 1 ? '' : 's'} that cost roughly ${money(annual)} a year (an estimate). The biggest: ${live.slice(0, 3).map((i) => `${i.displayName} (${money(i.annualCostPaise)}/yr)`).join(', ')}.`
          : 'I could not find recurring payments in your history yet — I need at least three charges from a merchant to spot a pattern.',
        period: null,
        rangeForCoverage: null,
        count: live.reduce((s, i) => s + i.occurrences, 0),
        breakdown: live.slice(0, 6).map((i) => ({ slug: i.platform ?? undefined, label: i.displayName, paise: i.annualCostPaise, display: `${money(i.annualCostPaise)}/yr`, count: i.occurrences })),
        calculation: live.slice(0, 3).map((i) => `${i.displayName}: ${money(i.amountPaise)} every ~${i.intervalDays} days ≈ ${money(i.annualCostPaise)} a year`),
        metrics: [metric('annual', 'Estimated yearly cost', 'estimate', money(annual), { paise: annual }), metric('count', 'Recurring payments', 'verified', String(live.length), { value: live.length })],
        statements: [
          ...live.slice(0, 3).map((i) => ({ kind: 'verified' as const, text: `${i.displayName}: ${i.occurrences} charges, latest ${money(i.lastAmountPaise)}${i.priceChanges.length ? `; price changed from ${money(i.priceChanges[i.priceChanges.length - 1]!.fromPaise)} to ${money(i.priceChanges[i.priceChanges.length - 1]!.toPaise)}` : ''}.` })),
          { kind: 'suggestion', text: 'Review which of these you still use. Spendly cannot cancel anything or check cancellation terms for you.' },
          { kind: 'verified', text: 'Rent, bills, health and education payments are left out because they are not optional subscriptions.' },
        ],
        nextAction: { label: 'Open recurring payments', href: '/recurring' },
      });
    }

    case 'savings_opportunities': {
      const insights = await listInsights(auth, lk);
      const opps = insights.items.filter((i) => i.type === 'savings_opportunity');
      const total = insights.potentialSavingsMonthlyPaise;
      return done({
        headline: opps.length
          ? `Your clearest opportunities are ${opps.map((o) => o.title.replace('Trim ', '').replace(' by 20%', '')).join(', ')} — trimming each by 20% could free about ${money(total)} a month in total (an estimate).`
          : 'I do not have enough history yet to suggest savings — I look for discretionary categories averaging at least ₹1,500 a month over two or more months.',
        period: null,
        rangeForCoverage: null,
        count: 0,
        breakdown: opps.map((o) => ({ slug: o.evidence.scope?.category, label: o.title.replace('Trim ', '').replace(' by 20%', ''), paise: o.estimatedMonthlySavingsPaise ?? 0, display: `≈ ${money(o.estimatedMonthlySavingsPaise ?? 0)}/mo` })),
        calculation: opps.flatMap((o) => o.evidence.calculation.slice(0, 1)),
        metrics: opps.length ? [metric('total', 'Estimated monthly saving', 'estimate', money(total), { paise: total })] : [],
        statements: opps.flatMap((o) => o.statements.filter((s) => s.kind !== 'verified').slice(0, 2)),
        confidenceOverride: opps.length
          ? { level: opps.every((o) => o.confidence >= 0.7) ? 'medium' : 'low', reason: 'Estimates assume your spending pattern stays the same.' }
          : { level: 'low', reason: 'Not enough history.' },
        nextAction: { label: 'See all insights', href: '/coach' },
      });
    }

    case 'budget_status': {
      const budgets = (await listBudgetDtos(auth, now)).filter((b) => b.isActive);
      const worst = [...budgets].sort((a, b) => b.progress.percentUsed - a.progress.percentUsed)[0];
      return done({
        headline: budgets.length
          ? `${worst ? `${worst.name} is the closest to its limit: ${money(worst.progress.spentPaise)} of ${money(worst.amountPaise)} used (${Math.round(worst.progress.percentUsed)}%).` : ''} You have ${budgets.length} active budget${budgets.length === 1 ? '' : 's'}.`
          : 'You have no budgets yet. Setting one lets me track your progress and warn you before you overspend.',
        period: null,
        rangeForCoverage: null,
        count: 0,
        breakdown: budgets.map((b) => ({ label: b.name, paise: b.progress.spentPaise, display: `${money(b.progress.spentPaise)} of ${money(b.amountPaise)}`, sharePct: Math.min(999, b.progress.percentUsed) })),
        calculation: budgets.slice(0, 3).map((b) => `${b.name}: ${money(b.progress.spentPaise)} ÷ ${money(b.amountPaise)} = ${Math.round(b.progress.percentUsed)}%${b.projection ? `; projected ${money(b.projection.projectedPaise)} by the end of the period (estimate)` : ''}`),
        metrics: budgets.slice(0, 4).map((b) => metric(b.id, b.name, 'verified', `${Math.round(b.progress.percentUsed)}%`, { value: b.progress.percentUsed })),
        statements: budgets.slice(0, 3).flatMap((b) => [
          { kind: 'verified' as const, text: `${b.name}: ${money(b.progress.spentPaise)} spent, ${money(Math.max(0, b.progress.remainingPaise))} remaining in ${b.window.label.toLowerCase()}.` },
          ...(b.projection ? [{ kind: 'estimate' as const, text: `At this pace ${b.name} would reach about ${money(b.projection.projectedPaise)} (${b.projection.confidence} confidence).` }] : []),
        ]),
        nextAction: { label: 'Open budgets', href: '/budgets' },
      });
    }

    case 'help':
      return done({
        headline: plan.reason ?? 'I can answer questions about your own spending — try one of the suggestions below.',
        period: null,
        rangeForCoverage: null,
        count: 0,
        confidenceOverride: { level: 'low', reason: 'I could not turn that into a question I can verify against your data.' },
        statements: [{ kind: 'suggestion', text: 'Ask about a platform or category and a period, e.g. "How much did I spend on Zomato last month?"' }],
        nextAction: { label: 'Browse insights', href: '/coach' },
      });
  }
}

/** The only content a language model is allowed to see about an answer: verified figures and labels. */
export function factsForLlm(a: CoachAnswer) {
  return {
    intent: a.plan.intent,
    headline: a.headline,
    period: a.period?.label ?? null,
    comparedWith: a.baseline?.label ?? null,
    metrics: a.metrics.map((m) => ({ label: m.label, display: m.display, kind: m.kind })),
    breakdown: a.breakdown.slice(0, 8).map((r) => ({ label: r.label, display: r.display, count: r.count ?? null, sharePct: r.sharePct === null || r.sharePct === undefined ? null : Math.round(r.sharePct * 10) / 10, changePct: r.changePct === null || r.changePct === undefined ? null : Math.round(r.changePct) })),
    calculation: a.calculation,
    caveats: a.coverage.notes,
    confidence: a.confidence,
    estimatesAreLabelled: a.statements.filter((s) => s.kind === 'estimate').map((s) => s.text),
  };
}

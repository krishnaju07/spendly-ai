import { DateTime } from 'luxon';
import {
  describeDetail,
  formatINR,
  lastMonths,
  percentChange,
  previousPeriod,
  type ReportDto,
  type ResolvedRange,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Transaction } from '../models/finance';
import { categoryStats, periodTotals, platformStats, totalsForMatch, transactionInsights, trendSeries } from './analytics';
import { listBudgetDtos } from './budgets';
import { highlightsFor } from './insights';
import type { Lookups } from './lookups';
import { rangeDto } from './query';
import { recurringSummary } from './recurring';

export const REPORT_TYPES = ['monthly-spending', 'yearly-spending', 'platform-comparison', 'category-analysis', 'subscriptions', 'budget-performance', 'spending-changes', 'ai-summary'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const DEFAULT_RANGE: Record<ReportType, 'this_month' | 'this_year' | 'last_month'> = {
  'monthly-spending': 'this_month',
  'yearly-spending': 'this_year',
  'platform-comparison': 'this_month',
  'category-analysis': 'this_month',
  subscriptions: 'this_month',
  'budget-performance': 'this_month',
  'spending-changes': 'this_month',
  'ai-summary': 'last_month',
};

type Section = ReportDto['sections'][number];
const money = (p: number) => formatINR(p, { decimals: 'auto' });
const pct = (v: number | null) => (v === null ? 'new' : Math.round(v) === 0 ? 'unchanged' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`);

/** The change against the comparison period as words, and whether it is good news (spending less) or not. */
function deltaOf(change: number | null): { delta?: string; tone?: 'good' | 'bad' | 'flat' } {
  if (change === null) return { delta: 'new', tone: 'flat' };
  const rounded = Math.round(change);
  // A tiny earlier period turns a small change into a four-digit percentage that reads like a bug.
  const delta = rounded > 999 ? '> +999%' : pct(change);
  return { delta, tone: rounded === 0 ? 'flat' : rounded > 0 ? 'bad' : 'good' };
}

/** One bar per local day from the start of the range to today (or its end), days with no spending as zero. */
function dayBars(daily: Array<{ day: string; paise: number }>, range: ResolvedRange, tz: string, now: Date): Array<{ label: string; full: string; paise: number }> {
  const byDay = new Map(daily.map((d) => [d.day, d.paise]));
  const start = DateTime.fromJSDate(range.from, { zone: tz }).startOf('day');
  const end = DateTime.min(DateTime.fromJSDate(range.to, { zone: tz }).minus({ days: 1 }).startOf('day'), DateTime.fromJSDate(now, { zone: tz }).startOf('day'));
  const bars: Array<{ label: string; full: string; paise: number }> = [];
  for (let d = start; d <= end && bars.length < 400; d = d.plus({ days: 1 })) bars.push({ label: String(d.day), full: d.toFormat('d LLL'), paise: byDay.get(d.toISODate() ?? '') ?? 0 });
  return bars;
}

const categoryTable = (rows: Awaited<ReturnType<typeof categoryStats>>): Section => ({
  title: 'Spending by category',
  columns: [
    { key: 'name', label: 'Category' },
    { key: 'net', label: 'Net spend', align: 'right', format: 'money' },
    { key: 'share', label: 'Share', align: 'right', format: 'percent' },
    { key: 'count', label: 'Purchases', align: 'right', format: 'number' },
    { key: 'prev', label: 'Previous period', align: 'right', format: 'money' },
    { key: 'change', label: 'Change', align: 'right', format: 'percent' },
  ],
  rows: rows.map((r) => ({ name: r.name, net: r.netPaise, share: r.sharePct, count: r.count, prev: r.previousNetPaise, change: r.changePct })),
});

const platformTable = (rows: Awaited<ReturnType<typeof platformStats>>): Section => ({
  title: 'Spending by platform',
  columns: [
    { key: 'name', label: 'Platform' },
    { key: 'net', label: 'Net spend', align: 'right', format: 'money' },
    { key: 'count', label: 'Orders', align: 'right', format: 'number' },
    { key: 'avg', label: 'Average order', align: 'right', format: 'money' },
    { key: 'prev', label: 'Previous period', align: 'right', format: 'money' },
    { key: 'change', label: 'Change', align: 'right', format: 'percent' },
  ],
  rows: rows.map((r) => ({ name: r.name, net: r.netPaise, count: r.count, avg: r.avgPaise, prev: r.previousNetPaise, change: r.changePct })),
});

/** Builds a report from stored transactions only, for the user's timezone and the chosen date range. */
export async function buildReport(auth: AuthContext, lk: Lookups, type: ReportType, range: ResolvedRange, now = new Date()): Promise<ReportDto> {
  const baseline = previousPeriod(range, now);
  const [totals, cats, plats] = await Promise.all([periodTotals(auth, range, baseline), categoryStats(auth, lk, range, baseline), platformStats(auth, lk, range, baseline)]);
  const t = totals.current;
  const p = totals.previous;
  const summary: ReportDto['summary'] = [
    { label: 'Net spending', value: money(t.netPaise) },
    { label: 'Purchases', value: money(t.grossPaise) },
    { label: 'Refunds', value: money(t.refundsPaise) },
    ...(auth.prefs.incomeTracking ? [{ label: 'Income', value: money(t.incomePaise) }] : []),
    { label: baseline.baselineLabel, value: money(p.netPaise), ...deltaOf(percentChange(t.netPaise, p.netPaise)) },
    { label: 'Transactions', value: String(t.expenseCount) },
  ];
  const head = { range: rangeDto(range), generatedAt: now.toISOString(), timezone: auth.tz, isDemo: auth.user.isDemo };

  switch (type) {
    case 'monthly-spending': {
      const top = await Transaction.find({ userId: auth.userId, type: 'expense', status: 'completed', date: { $gte: range.from, $lt: range.to } }).sort({ amountPaise: -1 }).limit(10).lean();
      const insights = await transactionInsights({ userId: auth.userId, date: { $gte: range.from, $lt: range.to } }, auth.tz);
      return {
        type,
        title: 'Monthly spending report',
        subtitle: range.label,
        ...head,
        summary,
        chart: { title: 'Spend by day', bars: dayBars(insights.daily, range, auth.tz, now) },
        food: insights.places.length ? { places: insights.places, dishes: insights.dishes, diet: insights.diet } : undefined,
        sections: [
          categoryTable(cats),
          platformTable(plats),
          {
            title: 'Largest purchases',
            columns: [
              { key: 'date', label: 'Date', format: 'date' },
              { key: 'merchant', label: 'Merchant' },
              { key: 'what', label: 'What' },
              { key: 'category', label: 'Category' },
              { key: 'amount', label: 'Amount', align: 'right', format: 'money' },
            ],
            rows: top.map((x) => ({ date: DateTime.fromJSDate(x.date, { zone: auth.tz }).toISODate(), merchant: x.orderDetail?.place ?? x.merchantName, what: x.orderDetail?.items.length ? describeDetail({ ...x.orderDetail, place: null }) : null, category: lk.categoryName(x.category) ?? 'Uncategorized', amount: x.amountPaise })),
          },
        ],
      };
    }
    case 'yearly-spending': {
      const months = lastMonths(12, auth.tz, range.to);
      const series = await trendSeries(auth, { from: range.unit === 'year' || range.unit === 'fy' ? range.from : months[0]!.from, to: range.to }, 'month');
      return {
        type,
        title: 'Yearly spending report',
        subtitle: range.label,
        ...head,
        summary,
        chart: { title: 'Spend by month', bars: series.map((m) => ({ label: m.label, full: m.label, paise: m.netPaise })) },
        sections: [
          {
            title: 'Month by month',
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'gross', label: 'Purchases', align: 'right', format: 'money' },
              { key: 'refunds', label: 'Refunds', align: 'right', format: 'money' },
              { key: 'net', label: 'Net spend', align: 'right', format: 'money' },
              { key: 'income', label: 'Income', align: 'right', format: 'money' },
            ],
            rows: series.map((m) => ({ month: m.label, gross: m.grossPaise, refunds: m.refundsPaise, net: m.netPaise, income: m.incomePaise })),
          },
          categoryTable(cats),
        ],
      };
    }
    case 'platform-comparison':
      return { type, title: 'Platform comparison', subtitle: range.label, ...head, summary, sections: [platformTable(plats)] };
    case 'category-analysis':
      return { type, title: 'Category analysis', subtitle: range.label, ...head, summary, sections: [categoryTable(cats)] };
    case 'spending-changes': {
      const movers = [...cats].filter((c) => c.previousNetPaise !== c.netPaise).sort((a, b) => Math.abs(b.netPaise - b.previousNetPaise) - Math.abs(a.netPaise - a.previousNetPaise)).slice(0, 15);
      return {
        type,
        title: 'Spending changes',
        subtitle: `${range.label} compared with ${baseline.baselineLabel.toLowerCase()}`,
        ...head,
        summary,
        sections: [
          {
            title: 'Biggest category movers',
            columns: [
              { key: 'name', label: 'Category' },
              { key: 'now', label: 'This period', align: 'right', format: 'money' },
              { key: 'before', label: 'Comparison', align: 'right', format: 'money' },
              { key: 'delta', label: 'Difference', align: 'right', format: 'money' },
              { key: 'change', label: 'Change', align: 'right', format: 'percent' },
            ],
            rows: movers.map((c) => ({ name: c.name, now: c.netPaise, before: c.previousNetPaise, delta: c.netPaise - c.previousNetPaise, change: c.changePct })),
          },
          platformTable(plats),
        ],
      };
    }
    case 'subscriptions': {
      const rec = await recurringSummary(auth, lk, now);
      const items = rec.items.filter((i) => i.status !== 'dismissed');
      return {
        type,
        title: 'Subscription & recurring payments report',
        subtitle: 'Detected from your payment history — estimates, not confirmed contracts',
        ...head,
        summary: [
          { label: 'Confirmed (yearly, est.)', value: money(rec.totals.confirmedAnnualPaise) },
          { label: 'Awaiting confirmation (yearly, est.)', value: money(rec.totals.detectedAnnualPaise) },
          { label: 'Recurring payments', value: String(items.length) },
        ],
        sections: [
          {
            title: 'Recurring payments',
            note: 'Next-payment dates appear only where the pattern is regular enough to estimate. Spendly cannot verify whether a subscription can be cancelled.',
            columns: [
              { key: 'name', label: 'Merchant' },
              { key: 'status', label: 'Status' },
              { key: 'frequency', label: 'Frequency' },
              { key: 'amount', label: 'Typical amount', align: 'right', format: 'money' },
              { key: 'monthly', label: 'Monthly cost', align: 'right', format: 'money' },
              { key: 'annual', label: 'Yearly cost', align: 'right', format: 'money' },
              { key: 'last', label: 'Last charge', format: 'date' },
              { key: 'next', label: 'Next (estimate)', format: 'date' },
              { key: 'confidence', label: 'Confidence' },
            ],
            rows: items.map((i) => ({ name: i.displayName, status: i.status, frequency: i.frequencyLabel, amount: i.amountPaise, monthly: i.monthlyCostPaise, annual: i.annualCostPaise, last: i.lastDate.slice(0, 10), next: i.nextExpectedDate?.slice(0, 10) ?? null, confidence: `${i.confidenceLabel} (${Math.round(i.confidence * 100)}%)` })),
          },
        ],
      };
    }
    case 'budget-performance': {
      const budgets = await listBudgetDtos(auth, now);
      return {
        type,
        title: 'Budget performance',
        subtitle: 'Current budget periods',
        ...head,
        summary: [{ label: 'Active budgets', value: String(budgets.filter((b) => b.isActive).length) }, { label: 'Over budget', value: String(budgets.filter((b) => b.progress.level === 'exceeded').length) }],
        sections: [
          {
            title: 'Budgets',
            note: 'Projected spend is a straight-line estimate and does not know about bills due later in the period.',
            columns: [
              { key: 'name', label: 'Budget' },
              { key: 'period', label: 'Period' },
              { key: 'budget', label: 'Budget', align: 'right', format: 'money' },
              { key: 'spent', label: 'Spent', align: 'right', format: 'money' },
              { key: 'remaining', label: 'Remaining', align: 'right', format: 'money' },
              { key: 'used', label: 'Used', align: 'right', format: 'percent' },
              { key: 'projected', label: 'Projected (est.)', align: 'right', format: 'money' },
            ],
            rows: budgets.map((b) => ({ name: b.name, period: b.window.label, budget: b.amountPaise, spent: b.progress.spentPaise, remaining: b.progress.remainingPaise, used: b.progress.percentUsed, projected: b.projection?.projectedPaise ?? null })),
          },
        ],
      };
    }
    case 'ai-summary': {
      const highlights = await highlightsFor(auth, lk, range, now);
      const lines: string[] = [];
      lines.push(`You spent ${money(t.netPaise)} ${range.label.toLowerCase()} across ${t.expenseCount} purchases${t.refundsPaise > 0 ? `, after ${money(t.refundsPaise)} of refunds` : ''}.`);
      if (p.netPaise > 0) lines.push(`That is ${pct(percentChange(t.netPaise, p.netPaise))} compared with ${baseline.baselineLabel.toLowerCase()} (${money(p.netPaise)}).`);
      if (cats[0]) lines.push(`Your biggest category was ${cats[0].name} at ${money(cats[0].netPaise)}${cats[0].sharePct !== null ? ` (${Math.round(cats[0].sharePct)}% of spending)` : ''}.`);
      const topBrand = plats.find((x) => x.slug && lk.platforms.get(x.slug)?.kind === 'brand');
      if (topBrand) lines.push(`Your biggest platform was ${topBrand.name} at ${money(topBrand.netPaise)} over ${topBrand.count} order${topBrand.count === 1 ? '' : 's'}.`);
      for (const h of highlights.slice(0, 4)) lines.push(h);
      return {
        type,
        title: 'Monthly summary',
        subtitle: `${range.label} — generated from your verified transactions`,
        ...head,
        summary,
        sections: [{ title: 'Highlights', note: 'Every figure comes from your stored transactions; wording is deterministic.', columns: [{ key: 'line', label: 'Summary' }], rows: lines.map((line) => ({ line })) }, categoryTable(cats.slice(0, 8))],
      };
    }
  }
}

/** Flattens a report to CSV rows (money as plain decimals so it opens cleanly in a spreadsheet). */
export function reportToCsvRows(report: ReportDto): unknown[][] {
  const plain = (v: string | number | null, format?: string): string | number => {
    if (v === null) return '';
    if (typeof v === 'number' && format === 'money') return `${Math.floor(Math.abs(v) / 100)}.${String(Math.abs(v) % 100).padStart(2, '0')}`.replace(/^/, v < 0 ? '-' : '');
    if (typeof v === 'number' && format === 'percent') return Math.round(v * 10) / 10;
    return v;
  };
  const rows: unknown[][] = [[report.title], [report.subtitle], [`Period ${report.range.fromDate} to ${report.range.toDate}`, `Timezone ${report.timezone}`, report.isDemo ? 'DEMO DATA' : ''], []];
  for (const s of report.summary) rows.push([s.label, s.value, s.delta ?? '']);
  for (const section of report.sections) {
    rows.push([], [section.title]);
    if (section.note) rows.push([section.note]);
    rows.push(section.columns.map((c) => c.label));
    for (const r of section.rows) rows.push(section.columns.map((c) => plain(r[c.key] ?? null, c.format)));
  }
  return rows;
}

/** A statement is meant to be read and printed, so it stops at this many rows; the CSV and JSON exports have no limit. */
export const STATEMENT_ROW_CAP = 10_000;

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Every transaction matching `match` as a printable statement: the totals first, then one row per transaction,
 * newest first. `range` is the date range the person filtered by, or none for everything they have.
 */
export async function buildStatement(auth: AuthContext, lk: Lookups, match: Record<string, unknown>, range: ResolvedRange | undefined, now: Date): Promise<ReportDto> {
  const [rows, count, totals] = await Promise.all([
    Transaction.find(match).sort({ date: -1, _id: -1 }).limit(STATEMENT_ROW_CAP).lean(),
    Transaction.countDocuments(match),
    totalsForMatch(match),
  ]);
  const zone = auth.tz;
  const newest = rows[0]?.date ?? now;
  const oldest = rows[rows.length - 1]?.date ?? now;
  const dateOf = (d: Date) => DateTime.fromJSDate(d, { zone }).toISODate() ?? '';
  const span = range
    ? rangeDto(range)
    : { preset: 'custom' as const, from: oldest.toISOString(), to: newest.toISOString(), fromDate: dateOf(oldest), toDate: dateOf(newest), days: Math.max(1, Math.round((newest.getTime() - oldest.getTime()) / 86_400_000) + 1), elapsedDays: 0, inProgress: false, label: 'All transactions', timezone: zone };

  const truncated = count > rows.length;
  return {
    type: 'transaction-statement',
    title: 'Transaction statement',
    subtitle: range ? range.label : 'Every transaction in your records',
    range: span,
    generatedAt: now.toISOString(),
    timezone: zone,
    isDemo: auth.user.isDemo,
    summary: [
      { label: 'Transactions', value: new Intl.NumberFormat('en-IN').format(count) },
      { label: 'Net spending', value: formatINR(totals.netPaise, { decimals: 'auto' }) },
      { label: 'Purchases', value: formatINR(totals.grossPaise, { decimals: 'auto' }) },
      { label: 'Refunds', value: formatINR(totals.refundsPaise, { decimals: 'auto' }) },
      { label: 'Income', value: formatINR(totals.incomePaise, { decimals: 'auto' }) },
      { label: 'Average purchase', value: formatINR(totals.expenseCount ? Math.round(totals.grossPaise / totals.expenseCount) : 0, { decimals: 'auto' }) },
    ],
    sections: [
      {
        title: 'All transactions',
        note: [
          truncated ? `Showing the newest ${new Intl.NumberFormat('en-IN').format(rows.length)} of ${new Intl.NumberFormat('en-IN').format(count)} transactions; the CSV and JSON exports hold every one.` : null,
          'Refunds and income carry a +. Pending, failed and reversed transactions are marked and left out of the totals.',
        ].filter(Boolean).join(' '),
        columns: [
          { key: 'date', label: 'Date', format: 'date', weight: 0.74 },
          { key: 'merchant', label: 'Merchant', weight: 1.25 },
          { key: 'what', label: 'What', weight: 2.3 },
          { key: 'category', label: 'Category', weight: 1.2 },
          { key: 'amount', label: 'Amount', align: 'right', format: 'text' },
        ],
        rows: rows.map((x) => {
          const dishes = x.orderDetail?.items.length ? shorten(describeDetail({ ...x.orderDetail, place: null }), 110) : null;
          const note = x.description && x.description.trim().toLowerCase() !== x.merchantName.toLowerCase() ? shorten(x.description, 90) : null;
          const platform = lk.platformName(x.platform);
          const category = lk.categoryName(x.category) ?? 'Uncategorized';
          return {
            date: dateOf(x.date),
            merchant: x.orderDetail?.place ?? x.merchantName,
            what: [dishes ?? note, x.status === 'completed' ? null : `(${x.status})`].filter(Boolean).join(' ') || null,
            category: platform && platform !== x.merchantName ? `${category} · ${platform}` : category,
            amount: formatINR(x.amountPaise, { decimals: 'auto', signed: x.type === 'income' || x.type === 'refund' }),
          };
        }),
      },
    ],
  };
}

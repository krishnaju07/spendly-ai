import { DateTime } from 'luxon';
import type { PipelineStage, Types } from 'mongoose';
import {
  UNASSIGNED_PLATFORM_LABEL,
  percentChange,
  share,
  type CategoryStatDto,
  type PatternsDto,
  type PeriodTotals,
  type PlatformStatDto,
  type TransactionInsightsDto,
  type TrendPointDto,
  type MerchantStatDto,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Transaction } from '../models/finance';
import type { Lookups } from './lookups';
import { buildMatch, type FilterQueryInput } from './query';

/**
 * Money maths lives in the database. Totals count *completed* expenses, refunds and income;
 * transfers never count. Net spend = purchases − refunds, so a refund reduces spending instead of
 * inflating income, and gross/net are always available separately.
 */

const isType = (t: string) => ({ $eq: ['$type', t] });
const sumIf = (cond: unknown) => ({ $sum: { $cond: [cond, '$amountPaise', 0] } });
const countIf = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } });

const TOTALS = {
  grossPaise: sumIf(isType('expense')),
  refundsPaise: sumIf(isType('refund')),
  incomePaise: sumIf(isType('income')),
  expenseCount: countIf(isType('expense')),
  refundCount: countIf(isType('refund')),
  incomeCount: countIf(isType('income')),
};

const COUNTED_TYPES = ['expense', 'refund', 'income'] as const;
const SPEND_TYPES = ['expense', 'refund'] as const;

interface Span {
  from: Date;
  to: Date;
}

export const emptyTotals = (): PeriodTotals => ({
  grossPaise: 0,
  refundsPaise: 0,
  netPaise: 0,
  incomePaise: 0,
  expenseCount: 0,
  refundCount: 0,
  incomeCount: 0,
});

const withNet = (t: Omit<PeriodTotals, 'netPaise'>): PeriodTotals => ({ ...t, netPaise: t.grossPaise - t.refundsPaise });

const periodStage = (cur: Span): PipelineStage => ({
  $addFields: {
    period: { $cond: [{ $and: [{ $gte: ['$date', cur.from] }, { $lt: ['$date', cur.to] }] }, 'current', 'previous'] },
  },
});

const twoRanges = (cur: Span, prev: Span) => ({
  $or: [{ date: { $gte: cur.from, $lt: cur.to } }, { date: { $gte: prev.from, $lt: prev.to } }],
});

/** Current and baseline totals in a single indexed pass. */
export async function periodTotals(
  auth: AuthContext,
  cur: Span,
  prev: Span,
  filters?: FilterQueryInput,
): Promise<{ current: PeriodTotals; previous: PeriodTotals }> {
  const match = { ...buildMatch(auth, { filters, statuses: ['completed'], types: COUNTED_TYPES }), ...twoRanges(cur, prev) };
  const rows = await Transaction.aggregate<{ _id: 'current' | 'previous' } & Omit<PeriodTotals, 'netPaise'>>([
    { $match: match },
    periodStage(cur),
    { $group: { _id: '$period', ...TOTALS } },
  ]);
  const out = { current: emptyTotals(), previous: emptyTotals() };
  for (const row of rows) {
    const { _id, ...rest } = row;
    out[_id] = withNet(rest);
  }
  return out;
}

export async function netSpend(
  auth: AuthContext,
  span: Span,
  scope: { categories?: string[]; platforms?: string[] } = {},
): Promise<{ netPaise: number; grossPaise: number; refundsPaise: number; count: number }> {
  const match = buildMatch(auth, {
    range: span,
    statuses: ['completed'],
    types: SPEND_TYPES,
    filters: { category: scope.categories, platform: scope.platforms },
  });
  const [row] = await Transaction.aggregate<{ grossPaise: number; refundsPaise: number; expenseCount: number }>([
    { $match: match },
    { $group: { _id: null, ...TOTALS } },
  ]);
  const gross = row?.grossPaise ?? 0;
  const refunds = row?.refundsPaise ?? 0;
  return { netPaise: gross - refunds, grossPaise: gross, refundsPaise: refunds, count: row?.expenseCount ?? 0 };
}

interface GroupRow extends Omit<PeriodTotals, 'netPaise'> {
  _id: { period: 'current' | 'previous'; key: string | null };
}

async function groupedStats(
  auth: AuthContext,
  field: 'platform' | 'category',
  cur: Span,
  prev: Span,
  filters?: FilterQueryInput,
) {
  const match = { ...buildMatch(auth, { filters, statuses: ['completed'], types: SPEND_TYPES }), ...twoRanges(cur, prev) };
  const rows = await Transaction.aggregate<GroupRow>([
    { $match: match },
    periodStage(cur),
    { $group: { _id: { period: '$period', key: `$${field}` }, ...TOTALS } },
  ]);
  const map = new Map<string | null, { cur: PeriodTotals; prev: PeriodTotals }>();
  for (const r of rows) {
    const key = r._id.key ?? null;
    const entry = map.get(key) ?? { cur: emptyTotals(), prev: emptyTotals() };
    const { _id, ...rest } = r;
    if (_id.period === 'current') entry.cur = withNet(rest);
    else entry.prev = withNet(rest);
    map.set(key, entry);
  }
  return map;
}

export async function platformStats(
  auth: AuthContext,
  lk: Lookups,
  cur: Span,
  prev: Span,
  filters?: FilterQueryInput,
): Promise<PlatformStatDto[]> {
  const map = await groupedStats(auth, 'platform', cur, prev, filters);
  return [...map.entries()]
    .map(([slug, { cur: c, prev: p }]) => ({
      slug,
      name: slug ? (lk.platformName(slug) ?? slug) : UNASSIGNED_PLATFORM_LABEL,
      grossPaise: c.grossPaise,
      refundsPaise: c.refundsPaise,
      netPaise: c.netPaise,
      count: c.expenseCount,
      avgPaise: c.expenseCount ? Math.round(c.grossPaise / c.expenseCount) : 0,
      previousNetPaise: p.netPaise,
      previousCount: p.expenseCount,
      changePct: percentChange(c.netPaise, p.netPaise),
    }))
    .filter((r) => r.netPaise !== 0 || r.previousNetPaise !== 0 || r.count > 0)
    .sort((a, b) => b.netPaise - a.netPaise);
}

export async function categoryStats(
  auth: AuthContext,
  lk: Lookups,
  cur: Span,
  prev: Span,
  filters?: FilterQueryInput,
): Promise<CategoryStatDto[]> {
  const map = await groupedStats(auth, 'category', cur, prev, filters);
  const rows = [...map.entries()].map(([slug, { cur: c, prev: p }]) => ({
    slug,
    name: slug ? (lk.categoryName(slug) ?? slug) : 'Uncategorized',
    grossPaise: c.grossPaise,
    refundsPaise: c.refundsPaise,
    netPaise: c.netPaise,
    count: c.expenseCount,
    previousNetPaise: p.netPaise,
    changePct: percentChange(c.netPaise, p.netPaise),
  }));
  const total = rows.reduce((s, r) => s + Math.max(0, r.netPaise), 0);
  return rows
    .filter((r) => r.netPaise !== 0 || r.previousNetPaise !== 0 || r.count > 0)
    .map((r) => ({ ...r, sharePct: share(Math.max(0, r.netPaise), total) }))
    .sort((a, b) => b.netPaise - a.netPaise);
}

// ── time series ────────────────────────────────────────────────────────────────────────────────

export type Granularity = 'day' | 'week' | 'month';

function bucketExpr(g: Granularity, tz: string, weekStartsOn: 1 | 7) {
  if (g === 'day') return { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } };
  if (g === 'month') return { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } };
  return {
    $dateToString: {
      format: '%Y-%m-%d',
      timezone: tz,
      date: { $dateTrunc: { date: '$date', unit: 'week', timezone: tz, startOfWeek: weekStartsOn === 7 ? 'sunday' : 'monday' } },
    },
  };
}

function bucketKeys(span: Span, g: Granularity, tz: string, weekStartsOn: 1 | 7): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const end = DateTime.fromJSDate(span.to, { zone: tz });
  let cursor = DateTime.fromJSDate(span.from, { zone: tz }).startOf('day');
  if (g === 'month') cursor = cursor.startOf('month');
  if (g === 'week') cursor = cursor.minus({ days: weekStartsOn === 1 ? cursor.weekday - 1 : cursor.weekday % 7 });
  const step = g === 'day' ? { days: 1 } : g === 'week' ? { weeks: 1 } : { months: 1 };
  while (cursor < end && out.length < 800) {
    out.push({
      key: g === 'month' ? cursor.toFormat('yyyy-LL') : (cursor.toISODate() as string),
      label: g === 'month' ? cursor.toFormat("LLL ''yy") : cursor.toFormat('d LLL'),
    });
    cursor = cursor.plus(step);
  }
  return out;
}

export async function trendSeries(
  auth: AuthContext,
  span: Span,
  granularity: Granularity,
  filters?: FilterQueryInput,
): Promise<TrendPointDto[]> {
  const match = buildMatch(auth, { range: span, filters, statuses: ['completed'], types: COUNTED_TYPES });
  const rows = await Transaction.aggregate<{ _id: string } & Omit<PeriodTotals, 'netPaise'>>([
    { $match: match },
    { $group: { _id: bucketExpr(granularity, auth.tz, auth.weekStartsOn), ...TOTALS } },
  ]);
  const byKey = new Map(rows.map((r) => [r._id, r]));
  return bucketKeys(span, granularity, auth.tz, auth.weekStartsOn).map(({ key, label }) => {
    const r = byKey.get(key);
    return {
      key,
      label,
      grossPaise: r?.grossPaise ?? 0,
      refundsPaise: r?.refundsPaise ?? 0,
      netPaise: (r?.grossPaise ?? 0) - (r?.refundsPaise ?? 0),
      incomePaise: r?.incomePaise ?? 0,
      count: r?.expenseCount ?? 0,
    };
  });
}

/** Cumulative net spend by day of the month, this month against last month. */
export async function monthOverMonth(auth: AuthContext, now = new Date()) {
  const startThis = DateTime.fromJSDate(now, { zone: auth.tz }).startOf('month');
  const startPrev = startThis.minus({ months: 1 });
  const endThis = startThis.plus({ months: 1 });
  const spanOf = (from: DateTime, to: DateTime): Span => ({ from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() });
  const [cur, prev] = await Promise.all([
    trendSeries(auth, spanOf(startThis, endThis), 'day'),
    trendSeries(auth, spanOf(startPrev, startThis), 'day'),
  ]);
  const todayIndex = DateTime.fromJSDate(now, { zone: auth.tz }).day - 1;
  const cumulative = (points: TrendPointDto[], until: number) => {
    let run = 0;
    return points.map((p, i) => {
      run += p.netPaise;
      return i <= until ? run : null;
    });
  };
  const days = Math.max(cur.length, prev.length);
  const curCum = cumulative(cur, todayIndex);
  const prevCum = cumulative(prev, prev.length);
  return {
    currentLabel: startThis.toFormat('LLLL'),
    previousLabel: startPrev.toFormat('LLLL'),
    points: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      currentPaise: curCum[i] ?? null,
      previousPaise: prevCum[i] ?? null,
    })),
  };
}

export async function patterns(auth: AuthContext, span: Span, filters?: FilterQueryInput): Promise<PatternsDto> {
  const match = buildMatch(auth, { range: span, filters, statuses: ['completed'], types: SPEND_TYPES });
  const net = { $sum: { $cond: [isType('expense'), '$amountPaise', { $multiply: ['$amountPaise', -1] }] } };
  const [weekdayRows, hourRows, coverage] = await Promise.all([
    Transaction.aggregate<{ _id: number; netPaise: number; count: number }>([
      { $match: match },
      { $group: { _id: { $isoDayOfWeek: { date: '$date', timezone: auth.tz } }, netPaise: net, count: countIf(isType('expense')) } },
    ]),
    Transaction.aggregate<{ _id: number; netPaise: number; count: number }>([
      { $match: { ...match, hasTime: true } },
      { $group: { _id: { $hour: { date: '$date', timezone: auth.tz } }, netPaise: net, count: countIf(isType('expense')) } },
    ]),
    Transaction.aggregate<{ total: number; timed: number }>([
      { $match: { ...match, type: 'expense' } },
      { $group: { _id: null, total: { $sum: 1 }, timed: { $sum: { $cond: ['$hasTime', 1, 0] } } } },
    ]),
  ]);
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wd = new Map(weekdayRows.map((r) => [r._id, r]));
  const hr = new Map(hourRows.map((r) => [r._id, r]));
  return {
    weekday: labels.map((label, i) => ({ weekday: i + 1, label, netPaise: wd.get(i + 1)?.netPaise ?? 0, count: wd.get(i + 1)?.count ?? 0 })),
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, netPaise: hr.get(hour)?.netPaise ?? 0, count: hr.get(hour)?.count ?? 0 })),
    timestampedShare: coverage[0] && coverage[0].total > 0 ? coverage[0].timed / coverage[0].total : null,
  };
}

export async function topMerchants(auth: AuthContext, span: Span, limit: number, filters?: FilterQueryInput): Promise<MerchantStatDto[]> {
  const match = buildMatch(auth, { range: span, filters, statuses: ['completed'], types: SPEND_TYPES });
  const rows = await Transaction.aggregate<{ _id: string; merchantName: string; platform: string | null; netPaise: number; count: number; lastDate: Date }>([
    { $match: match },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: '$merchantKey',
        merchantName: { $last: '$merchantName' },
        platform: { $last: '$platform' },
        netPaise: { $sum: { $cond: [isType('expense'), '$amountPaise', { $multiply: ['$amountPaise', -1] }] } },
        count: countIf(isType('expense')),
        lastDate: { $max: '$date' },
      },
    },
    { $sort: { netPaise: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({
    merchantKey: r._id,
    merchantName: r.merchantName,
    platform: r.platform,
    netPaise: r.netPaise,
    count: r.count,
    lastDate: r.lastDate.toISOString(),
  }));
}

/** Net spend per (month, category) — the basis for budget suggestions and savings opportunities. */
export async function monthlyNetByCategory(auth: AuthContext, span: Span): Promise<Map<string, Map<string, number>>> {
  const match = buildMatch(auth, { range: span, statuses: ['completed'], types: SPEND_TYPES });
  const rows = await Transaction.aggregate<{ _id: { month: string; category: string | null }; netPaise: number }>([
    { $match: match },
    {
      $group: {
        _id: { month: bucketExpr('month', auth.tz, auth.weekStartsOn), category: '$category' },
        netPaise: { $sum: { $cond: [isType('expense'), '$amountPaise', { $multiply: ['$amountPaise', -1] }] } },
      },
    },
  ]);
  const byCategory = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const cat = r._id.category ?? 'other';
    const months = byCategory.get(cat) ?? new Map<string, number>();
    months.set(r._id.month, (months.get(r._id.month) ?? 0) + r.netPaise);
    byCategory.set(cat, months);
  }
  return byCategory;
}

export async function dataCoverage(auth: AuthContext) {
  const [row] = await Transaction.aggregate<{ first: Date; last: Date; count: number; uncategorized: number }>([
    { $match: { userId: auth.userId, status: 'completed', type: { $in: [...SPEND_TYPES] } } },
    { $group: { _id: null, first: { $min: '$date' }, last: { $max: '$date' }, count: { $sum: 1 }, uncategorized: { $sum: { $cond: [{ $eq: ['$category', null] }, 1, 0] } } } },
  ]);
  return row ?? null;
}

export async function countNeedsReview(userId: Types.ObjectId): Promise<{ needsReview: number; possibleDuplicates: number }> {
  const [needsReview, possibleDuplicates] = await Promise.all([
    Transaction.countDocuments({ userId, 'classification.needsReview': true }),
    Transaction.countDocuments({ userId, duplicateStatus: 'possible' }),
  ]);
  return { needsReview, possibleDuplicates };
}

/** Totals for an arbitrary transaction filter (used by the ledger header and exports). */
export async function totalsForMatch(match: Record<string, unknown>): Promise<PeriodTotals> {
  const [row] = await Transaction.aggregate<Omit<PeriodTotals, 'netPaise'>>([
    { $match: { ...match, status: 'completed', type: { $in: [...COUNTED_TYPES] } } },
    { $group: { _id: null, ...TOTALS } },
  ]);
  return row ? withNet(row) : emptyTotals();
}

/** Beyond the total: per-day spend, the biggest purchase, and — for orders from linked accounts — favourite place, dish and veg split. */
export async function transactionInsights(match: Record<string, unknown>, tz: string): Promise<TransactionInsightsDto> {
  const spend = { ...match, status: 'completed', type: 'expense' };
  const [row] = await Transaction.aggregate<{
    overall: Array<{ count: number; spent: number }>;
    biggest: Array<{ amountPaise: number; merchantName: string; place: string | null; date: Date }>;
    places: Array<{ _id: string; orders: number; paise: number }>;
    dishes: Array<{ _id: string; times: number }>;
    diet: Array<{ _id: string | null; n: number }>;
    daily: Array<{ _id: string; paise: number }>;
  }>([
    { $match: spend },
    {
      $facet: {
        overall: [{ $group: { _id: null, count: { $sum: 1 }, spent: { $sum: '$amountPaise' } } }],
        biggest: [{ $sort: { amountPaise: -1 } }, { $limit: 1 }, { $project: { amountPaise: 1, merchantName: 1, place: '$orderDetail.place', date: 1 } }],
        places: [
          { $match: { 'orderDetail.place': { $type: 'string' } } },
          { $group: { _id: '$orderDetail.place', orders: { $sum: 1 }, paise: { $sum: '$amountPaise' } } },
          { $sort: { orders: -1, paise: -1 } },
          { $limit: 5 },
        ],
        dishes: [{ $unwind: '$orderDetail.items' }, { $group: { _id: '$orderDetail.items.name', times: { $sum: '$orderDetail.items.quantity' } } }, { $sort: { times: -1 } }, { $limit: 5 }],
        diet: [{ $unwind: '$orderDetail.items' }, { $group: { _id: '$orderDetail.items.diet', n: { $sum: '$orderDetail.items.quantity' } } }],
        daily: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } }, paise: { $sum: '$amountPaise' } } }, { $sort: { _id: 1 } }, { $limit: 400 }],
      },
    },
  ]);
  const overall = row?.overall[0];
  const count = overall?.count ?? 0;
  const spentPaise = overall?.spent ?? 0;
  const big = row?.biggest[0];
  const place = row?.places[0];
  const dish = row?.dishes[0];
  const dietCounts = { veg: 0, nonveg: 0, egg: 0 };
  for (const d of row?.diet ?? []) if (d._id === 'veg' || d._id === 'nonveg' || d._id === 'egg') dietCounts[d._id] = d.n;
  return {
    count,
    spentPaise,
    averagePaise: count ? Math.round(spentPaise / count) : 0,
    biggest: big ? { paise: big.amountPaise, title: big.place ?? big.merchantName, date: big.date.toISOString() } : null,
    topPlace: place ? { name: place._id, orders: place.orders, paise: place.paise } : null,
    topDish: dish ? { name: dish._id, times: dish.times } : null,
    places: (row?.places ?? []).map((x) => ({ name: x._id, orders: x.orders, paise: x.paise })),
    dishes: (row?.dishes ?? []).map((x) => ({ name: x._id, times: x.times })),
    diet: dietCounts.veg + dietCounts.nonveg + dietCounts.egg > 0 ? dietCounts : null,
    daily: (row?.daily ?? []).map((d) => ({ day: d._id, paise: d.paise })),
  };
}

export interface GroupedTrend {
  keys: Array<{ key: string; name: string }>;
  points: Array<{ key: string; label: string; values: Record<string, number> }>;
}

/** Net spend per time bucket split by category or platform: the top N series plus an "Other" remainder. */
export async function groupedTrend(
  auth: AuthContext,
  lk: Lookups,
  span: Span,
  granularity: Granularity,
  field: 'category' | 'platform',
  filters?: FilterQueryInput,
  topN = 6,
): Promise<GroupedTrend> {
  const match = buildMatch(auth, { range: span, filters, statuses: ['completed'], types: SPEND_TYPES });
  const rows = await Transaction.aggregate<{ _id: { bucket: string; key: string | null }; netPaise: number }>([
    { $match: match },
    {
      $group: {
        _id: { bucket: bucketExpr(granularity, auth.tz, auth.weekStartsOn), key: `$${field}` },
        netPaise: { $sum: { $cond: [isType('expense'), '$amountPaise', { $multiply: ['$amountPaise', -1] }] } },
      },
    },
  ]);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = r._id.key ?? 'none';
    totals.set(k, (totals.get(k) ?? 0) + r.netPaise);
  }
  const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);
  const nameOf = (k: string) => (k === 'none' ? (field === 'category' ? 'Uncategorized' : UNASSIGNED_PLATFORM_LABEL) : ((field === 'category' ? lk.categoryName(k) : lk.platformName(k)) ?? k));
  const byBucket = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = r._id.key ?? 'none';
    const slot = top.includes(k) ? k : 'other';
    const values = byBucket.get(r._id.bucket) ?? {};
    values[slot] = (values[slot] ?? 0) + r.netPaise;
    byBucket.set(r._id.bucket, values);
  }
  const hasOther = [...byBucket.values()].some((v) => (v.other ?? 0) !== 0);
  return {
    keys: [...top.map((k) => ({ key: k, name: nameOf(k) })), ...(hasOther ? [{ key: 'other', name: 'Other' }] : [])],
    points: bucketKeys(span, granularity, auth.tz, auth.weekStartsOn).map(({ key, label }) => ({ key, label, values: byBucket.get(key) ?? {} })),
  };
}

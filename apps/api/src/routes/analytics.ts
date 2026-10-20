import { Router } from 'express';
import { z } from 'zod';
import { customRange, type CompareDto, type ResolvedRange } from '@spendly/shared';
import { badRequest } from '../lib/errors';
import { authOf } from '../middleware/context';
import { validate } from '../middleware/validate';
import { categoryStats, groupedTrend, patterns, periodTotals, platformStats, topMerchants, trendSeries } from '../services/analytics';
import { loadLookups } from '../services/lookups';
import { baselineDto, filterQuery, rangeDto, rangeQuery, rangesFor } from '../services/query';

export const analyticsRouter = Router();

const base = rangeQuery.extend(filterQuery.shape);
type Q = z.output<typeof base>;
const filtersOf = (q: Q) => ({ category: q.category, platform: q.platform, paymentMethod: q.paymentMethod, type: q.type });

analyticsRouter.get('/platforms', validate({ query: base }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as Q;
  const { range, baseline } = rangesFor(auth, q);
  const lk = await loadLookups(auth.userId);
  res.json({ data: { range: rangeDto(range), baseline: baselineDto(baseline), items: await platformStats(auth, lk, range, baseline, filtersOf(q)) } });
});

analyticsRouter.get('/categories', validate({ query: base }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as Q;
  const { range, baseline } = rangesFor(auth, q);
  const lk = await loadLookups(auth.userId);
  res.json({ data: { range: rangeDto(range), baseline: baselineDto(baseline), items: await categoryStats(auth, lk, range, baseline, filtersOf(q)) } });
});

const trendsQuery = base.extend({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  groupBy: z.enum(['none', 'category', 'platform']).default('none'),
});

analyticsRouter.get('/trends', validate({ query: trendsQuery }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as z.output<typeof trendsQuery>;
  const { range } = rangesFor(auth, q);
  const filters = filtersOf(q);
  if (q.groupBy === 'none') {
    res.json({ data: { range: rangeDto(range), granularity: q.granularity, points: await trendSeries(auth, range, q.granularity, filters) } });
    return;
  }
  const lk = await loadLookups(auth.userId);
  res.json({ data: { range: rangeDto(range), granularity: q.granularity, grouped: await groupedTrend(auth, lk, range, q.granularity, q.groupBy, filters) } });
});

const compareQuery = base.extend({ compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Two periods side by side — by default the selected range against the one before it. */
analyticsRouter.get('/compare', validate({ query: compareQuery }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as z.output<typeof compareQuery>;
  const { range, baseline: auto } = rangesFor(auth, q);
  let baseline: ResolvedRange & { baselineLabel: string } = auto;
  if (q.compareFrom || q.compareTo) {
    if (!q.compareFrom || !q.compareTo) throw badRequest('Give both compareFrom and compareTo', undefined, 'INVALID_RANGE');
    try {
      baseline = { ...customRange(q.compareFrom, q.compareTo, auth.tz), baselineLabel: 'Comparison period' };
    } catch (e) {
      throw badRequest((e as Error).message, undefined, 'INVALID_RANGE');
    }
  }
  const lk = await loadLookups(auth.userId);
  const filters = filtersOf(q);
  const [totals, categories, platforms] = await Promise.all([
    periodTotals(auth, range, baseline, filters),
    categoryStats(auth, lk, range, baseline, filters),
    platformStats(auth, lk, range, baseline, filters),
  ]);
  const body: CompareDto = { current: rangeDto(range), baseline: baselineDto(baseline), totals, categories, platforms };
  res.json({ data: body });
});

analyticsRouter.get('/patterns', validate({ query: base }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as Q;
  const { range } = rangesFor(auth, q);
  res.json({ data: await patterns(auth, range, filtersOf(q)) });
});

analyticsRouter.get('/merchants', validate({ query: base.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) }) }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as Q & { limit: number };
  const { range } = rangesFor(auth, q);
  res.json({ data: await topMerchants(auth, range, q.limit, filtersOf(q)) });
});


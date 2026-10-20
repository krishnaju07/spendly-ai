import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  lastMonths,
  percentChange,
  type DashboardSummaryDto,
  type TrendsDto,
} from '@spendly/shared';
import { logger } from '../lib/logger';
import { authOf } from '../middleware/context';
import { validate } from '../middleware/validate';
import { Transaction } from '../models/finance';
import { AIInsight, Budget } from '../models/planning';
import { countNeedsReview, monthOverMonth, netSpend, patterns, periodTotals, platformStats, trendSeries } from '../services/analytics';
import { budgetWindow, checkBudgetAlerts } from '../services/budgets';
import { refreshInsights } from '../services/insights';
import { loadLookups } from '../services/lookups';
import { ensureUpcomingReminders } from '../services/recurring';
import { baselineDto, filterQuery, rangeDto, rangeQuery, rangesFor } from '../services/query';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', validate({ query: rangeQuery.extend(filterQuery.shape) }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as z.output<typeof rangeQuery> & z.output<typeof filterQuery>;
  const { range, baseline } = rangesFor(auth, q);
  const filters = { category: q.category, platform: q.platform, paymentMethod: q.paymentMethod, type: q.type, status: q.status };
  const lk = await loadLookups(auth.userId);
  const monthRange = budgetWindow(auth, { period: 'monthly', startDate: null, endDate: null });

  const [totals, platforms, counts, overallBudget, savingsDocs, hasData] = await Promise.all([
    periodTotals(auth, range, baseline, filters),
    platformStats(auth, lk, range, baseline, filters),
    countNeedsReview(auth.userId),
    Budget.findOne({ userId: auth.userId, scope: 'overall', period: 'monthly', isActive: true }).lean(),
    AIInsight.find({ userId: auth.userId, status: 'active', type: 'savings_opportunity' }).select('estimatedMonthlySavingsPaise confidence').lean(),
    Transaction.exists({ userId: auth.userId }),
  ]);

  let budget: DashboardSummaryDto['budget'] = null;
  if (overallBudget) {
    const { netPaise } = await netSpend(auth, monthRange);
    budget = {
      totalBudgetPaise: overallBudget.amountPaise,
      spentPaise: netPaise,
      remainingPaise: overallBudget.amountPaise - netPaise,
      percentUsed: (netPaise / overallBudget.amountPaise) * 100,
    };
  }

  const monthly = savingsDocs.reduce((s, d) => s + (d.estimatedMonthlySavingsPaise ?? 0), 0);
  const minConf = savingsDocs.reduce((m, d) => Math.min(m, d.confidence), 1);
  if (hasData && savingsDocs.length === 0) {
    // first visit with data: compute insights in the background so the next load has them
    void loadLookups(auth.userId).then((l) => refreshInsights(auth, l)).catch((e) => logger.warn({ err: e }, 'background insight refresh failed'));
  }
  void Promise.all([checkBudgetAlerts(auth), ensureUpcomingReminders(auth, lk)]).catch((e) => logger.warn({ err: e }, 'background reminders failed'));

  const body: DashboardSummaryDto = {
    range: rangeDto(range),
    baseline: baselineDto(baseline),
    current: totals.current,
    previous: totals.previous,
    changePct: {
      net: percentChange(totals.current.netPaise, totals.previous.netPaise),
      income: percentChange(totals.current.incomePaise, totals.previous.incomePaise),
      count: percentChange(totals.current.expenseCount, totals.previous.expenseCount),
    },
    budget,
    potentialSavings: monthly > 0 ? { monthlyPaise: monthly, insightCount: savingsDocs.length, confidence: minConf >= 0.7 ? 'medium' : 'low' } : null,
    topPlatforms: platforms.slice(0, 6),
    needsReview: counts.needsReview,
    possibleDuplicates: counts.possibleDuplicates,
    hasData: Boolean(hasData),
    incomeTracking: auth.prefs.incomeTracking,
    isDemo: auth.user.isDemo,
  };
  res.json({ data: body });
});

const trendsQuery = rangeQuery.extend(filterQuery.shape).extend({
  granularity: z.enum(['day', 'week', 'month']).default('month'),
  months: z.coerce.number().int().min(1).max(36).optional(),
});

dashboardRouter.get('/trends', validate({ query: trendsQuery }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as z.output<typeof trendsQuery>;
  const filters = { category: q.category, platform: q.platform, paymentMethod: q.paymentMethod, type: q.type };
  let span: { from: Date; to: Date };
  if (q.granularity === 'month' && !q.preset && !q.from) {
    const months = lastMonths(q.months ?? 12, auth.tz);
    span = { from: months[0]!.from, to: months[months.length - 1]!.to };
  } else span = rangesFor(auth, q).range;
  const body: TrendsDto = { granularity: q.granularity, points: await trendSeries(auth, span, q.granularity, filters) };
  res.json({ data: body });
});

dashboardRouter.get('/month-over-month', async (req, res) => {
  res.json({ data: await monthOverMonth(authOf(req)) });
});

/** Net spend for the last six months against the overall monthly budget (if one is set). */
dashboardRouter.get('/budget-vs-spend', async (req, res) => {
  const auth = authOf(req);
  const months = lastMonths(6, auth.tz);
  const [series, budget] = await Promise.all([
    trendSeries(auth, { from: months[0]!.from, to: months[months.length - 1]!.to }, 'month'),
    Budget.findOne({ userId: auth.userId, scope: 'overall', period: 'monthly', isActive: true }).lean(),
  ]);
  res.json({
    data: {
      budgetPaise: budget?.amountPaise ?? null,
      points: series.map((p) => ({ key: p.key, label: p.label, spentPaise: p.netPaise })),
      currentMonth: DateTime.now().setZone(auth.tz).toFormat('yyyy-LL'),
    },
  });
});

dashboardRouter.get('/patterns', validate({ query: rangeQuery }), async (req, res) => {
  const auth = authOf(req);
  const { range } = rangesFor(auth, req.valid.query);
  res.json({ data: await patterns(auth, range) });
});

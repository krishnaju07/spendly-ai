import {
  confidenceLabel,
  generateInsights,
  lastMonths,
  previousPeriod,
  resolveRange,
  type InsightContext,
  type InsightDraft,
  type InsightDto,
  type InsightsResponseDto,
  type InsightTxn,
  type RecurringCandidate,
  type ResolvedRange,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Transaction } from '../models/finance';
import { AIInsight, RecurringPayment, type AIInsightDoc } from '../models/planning';
import type { Lookups } from './lookups';
import { monthlyNetByCategory } from './analytics';
import { notify } from './notifications';
import { rangeDto } from './query';

const STALE_AFTER_MS = 6 * 3_600_000;
const HISTORY_MONTHS = 6;

/** Insights describe this month once ten days of it exist; before that, the trailing 30 days. */
export function insightRange(auth: AuthContext, now: Date): ResolvedRange {
  const mtd = resolveRange({ preset: 'this_month' }, auth.tz, now, { weekStartsOn: auth.weekStartsOn });
  return mtd.elapsedDays >= 10 ? mtd : resolveRange({ preset: 'last_30_days' }, auth.tz, now, { weekStartsOn: auth.weekStartsOn });
}

export async function buildInsightContext(
  auth: AuthContext,
  lk: Lookups,
  now: Date,
  range: ResolvedRange = insightRange(auth, now),
): Promise<{ ctx: InsightContext; rows: InsightTxn[] }> {
  const baseline = previousPeriod(range, now);
  const historyFrom = new Date(Math.min(baseline.from.getTime(), now.getTime() - HISTORY_MONTHS * 31 * 86_400_000));
  const docs = await Transaction.find({
    userId: auth.userId,
    status: 'completed',
    type: { $in: ['expense', 'refund'] },
    date: { $gte: historyFrom, $lt: range.to },
  })
    .select('date amountPaise type category platform merchantKey merchantName hasTime')
    .sort({ date: 1 })
    .limit(30_000)
    .lean();
  const rows: InsightTxn[] = docs.map((d) => ({
    id: d._id.toString(),
    date: d.date,
    amountPaise: d.amountPaise,
    type: d.type as 'expense' | 'refund',
    category: d.category,
    platform: d.platform,
    merchantKey: d.merchantKey,
    merchantName: d.merchantName,
    hasTime: d.hasTime,
  }));

  // complete months before the current one, oldest first
  const months = lastMonths(4, auth.tz, now).slice(0, 3);
  const byCategory = await monthlyNetByCategory(auth, { from: months[0]?.from ?? now, to: months[months.length - 1]?.to ?? now });
  const monthKeys = months.map((m) => m.key);
  const discretionary = new Set([...lk.categories.values()].filter((c) => c.discretionary).map((c) => c.slug));
  const monthlyDiscretionaryPaise = monthKeys.map((k) =>
    [...byCategory.entries()].reduce((s, [slug, m]) => s + (discretionary.has(slug) ? (m.get(k) ?? 0) : 0), 0),
  );
  const avgMonthlyByCategory: InsightContext['avgMonthlyByCategory'] = {};
  for (const [slug, m] of byCategory) {
    const values = monthKeys.map((k) => m.get(k) ?? 0).filter((v) => v > 0);
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    avgMonthlyByCategory[slug] = { avgPaise: Math.round(mean), months: values.length, cv: mean > 0 ? Math.sqrt(variance) / mean : 0 };
  }

  const recurringDocs = await RecurringPayment.find({ userId: auth.userId, status: { $ne: 'dismissed' } }).lean();
  const recurring: RecurringCandidate[] = recurringDocs.map((r) => ({
    merchantKey: r.merchantKey,
    displayName: r.displayName,
    platform: r.platform,
    category: r.category,
    frequency: r.frequency as RecurringCandidate['frequency'],
    intervalDays: r.intervalDays,
    amountPaise: r.overrides.amountPaise ?? r.amountPaise,
    amountMinPaise: r.amountMinPaise,
    amountMaxPaise: r.amountMaxPaise,
    amountVariable: r.amountVariable,
    occurrences: r.occurrences,
    firstDate: r.firstDate,
    lastDate: r.lastDate,
    lastAmountPaise: r.lastAmountPaise,
    nextExpectedDate: r.nextExpectedDate,
    possiblyInactive: r.possiblyInactive,
    priceChanges: r.priceChanges,
    monthlyCostPaise: r.monthlyCostPaise,
    annualCostPaise: r.annualCostPaise,
    confidence: r.confidence,
    confidenceLabel: confidenceLabel(r.confidence),
    reasons: r.reasons,
    transactionIds: r.transactionIds.map((t) => t.toString()),
  }));

  const info = (r: ResolvedRange) => ({ from: r.from, to: r.to, fromDate: r.fromDate, toDate: r.toDate, label: r.label });
  return {
    rows,
    ctx: {
      tz: auth.tz,
      now,
      current: { ...info(range), days: range.days, elapsedDays: range.elapsedDays },
      baseline: { ...info(baseline), label: baseline.baselineLabel },
      monthlyDiscretionaryPaise,
      avgMonthlyByCategory,
      recurring,
    },
  };
}

export async function refreshInsights(auth: AuthContext, lk: Lookups, now = new Date()): Promise<InsightDraft[]> {
  const startedAt = new Date();
  const { ctx, rows } = await buildInsightContext(auth, lk, now);
  const drafts = generateInsights(ctx, rows);

  if (drafts.length > 0) {
    const result = await AIInsight.bulkWrite(
      drafts.map((d) => ({
        updateOne: {
          filter: { userId: auth.userId, key: d.key },
          update: {
            $set: {
              type: d.type,
              severity: d.severity,
              title: d.title,
              summary: d.summary,
              statements: d.statements,
              evidence: d.evidence,
              confidence: d.confidence,
              estimatedMonthlySavingsPaise: d.estimatedMonthlySavingsPaise ?? null,
              action: d.action ?? null,
              generatedAt: startedAt,
            },
            $setOnInsert: { status: 'active' },
          },
          upsert: true,
        },
      })),
    );
    for (const idx of Object.keys(result.upsertedIds)) {
      const d = drafts[Number(idx)];
      if (d && (d.type === 'unusual_transaction' || d.type === 'possible_duplicate')) {
        await notify(auth, { type: 'insight', severity: 'warning', title: d.title, body: d.summary.slice(0, 300), link: '/coach', dedupeKey: `insight:${d.key}` });
      }
    }
  }
  // anything that is no longer true disappears; dismissals are kept so they do not resurface
  await AIInsight.deleteMany({ userId: auth.userId, status: 'active', generatedAt: { $lt: startedAt } });
  await AIInsight.deleteMany({ userId: auth.userId, status: 'dismissed', generatedAt: { $lt: new Date(startedAt.getTime() - 45 * 86_400_000) } });
  return drafts;
}

export const toInsightDto = (i: AIInsightDoc): InsightDto => ({
  id: i._id.toString(),
  type: i.type as InsightDto['type'],
  severity: i.severity,
  title: i.title,
  summary: i.summary,
  statements: i.statements as InsightDto['statements'],
  evidence: i.evidence as InsightDto['evidence'],
  confidence: i.confidence,
  confidenceLabel: confidenceLabel(i.confidence),
  estimatedMonthlySavingsPaise: i.estimatedMonthlySavingsPaise,
  action: i.action,
  status: i.status,
  generatedAt: i.generatedAt.toISOString(),
});

/** Estimated savings come only from scenario-based opportunities, one per category, so nothing is double counted. */
export const potentialSavings = (items: InsightDto[]): number =>
  items.filter((i) => i.type === 'savings_opportunity').reduce((s, i) => s + (i.estimatedMonthlySavingsPaise ?? 0), 0);

/** Active insights, regenerated first if they are stale or new transactions have arrived since. */
export async function listInsights(auth: AuthContext, lk: Lookups, opts: { force?: boolean } = {}): Promise<InsightsResponseDto> {
  const now = new Date();
  const [latest, newestTxn] = await Promise.all([
    AIInsight.findOne({ userId: auth.userId }).sort({ generatedAt: -1 }).select('generatedAt').lean(),
    Transaction.findOne({ userId: auth.userId }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]);
  const stale =
    !latest ||
    now.getTime() - latest.generatedAt.getTime() > STALE_AFTER_MS ||
    (newestTxn && newestTxn.updatedAt > latest.generatedAt);
  if (opts.force || stale) await refreshInsights(auth, lk, now);

  const docs = await AIInsight.find({ userId: auth.userId, status: 'active' }).lean();
  const rank = { warning: 0, info: 1, positive: 2 } as const;
  const items = docs.map(toInsightDto).sort((a, b) => rank[a.severity] - rank[b.severity] || b.confidence - a.confidence);
  const range = insightRange(auth, now);
  return {
    items,
    period: rangeDto(range),
    generatedAt: docs.reduce<Date | null>((m, d) => (!m || d.generatedAt > m ? d.generatedAt : m), null)?.toISOString() ?? null,
    potentialSavingsMonthlyPaise: potentialSavings(items),
  };
}


/** One-line, verified highlights for a period — used by the monthly summary report. */
export async function highlightsFor(auth: AuthContext, lk: Lookups, range: ResolvedRange, now: Date): Promise<string[]> {
  const { ctx, rows } = await buildInsightContext(auth, lk, now, range);
  const order = ['category_change', 'platform_change', 'weekend_spending', 'late_night_orders', 'frequent_small_purchases', 'unusual_transaction', 'possible_duplicate', 'subscription_review'];
  return generateInsights(ctx, rows)
    .filter((d) => order.includes(d.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .map((d) => d.summary);
}

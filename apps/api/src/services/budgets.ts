import { DateTime } from 'luxon';
import {
  budgetProgress,
  categoryName,
  customRange,
  formatINR,
  lastMonths,
  projectSpend,
  resolveRange,
  suggestBudget,
  type BudgetDto,
  type BudgetHistoryDto,
  type BudgetSuggestionDto,
  type ResolvedRange,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Budget, type BudgetDoc } from '../models/planning';
import { monthlyNetByCategory, netSpend } from './analytics';
import { notify } from './notifications';

/** The date window a budget currently applies to. Monthly and weekly budgets repeat; custom ones do not. */
export function budgetWindow(auth: AuthContext, b: Pick<BudgetDoc, 'period' | 'startDate' | 'endDate'>, now = new Date()): ResolvedRange {
  if (b.period === 'custom' && b.startDate && b.endDate) return customRange(b.startDate, b.endDate, auth.tz, now);
  return resolveRange({ preset: b.period === 'weekly' ? 'this_week' : 'this_month' }, auth.tz, now, { weekStartsOn: auth.weekStartsOn });
}

const scopeOf = (b: Pick<BudgetDoc, 'scope' | 'category' | 'platform'>) => ({
  categories: b.scope === 'category' && b.category ? [b.category] : undefined,
  platforms: b.scope === 'platform' && b.platform ? [b.platform] : undefined,
});

export async function toBudgetDto(auth: AuthContext, b: BudgetDoc, now = new Date()): Promise<BudgetDto> {
  const window = budgetWindow(auth, b, now);
  const { netPaise } = await netSpend(auth, window, scopeOf(b));
  const progress = budgetProgress(netPaise, b.amountPaise, b.alertThresholds);
  const projection = window.inProgress && window.elapsedDays > 0 ? projectSpend(netPaise, window.elapsedDays, window.days) : null;
  return {
    id: b._id.toString(),
    name: b.name,
    scope: b.scope,
    period: b.period,
    amountPaise: b.amountPaise,
    category: b.category,
    platform: b.platform,
    startDate: b.startDate,
    endDate: b.endDate,
    alertThresholds: b.alertThresholds,
    isActive: b.isActive,
    window: {
      fromDate: window.fromDate,
      toDate: window.toDate,
      label: window.label,
      days: window.days,
      elapsedDays: window.elapsedDays,
      inProgress: window.inProgress,
    },
    progress: {
      spentPaise: progress.spentPaise,
      remainingPaise: progress.remainingPaise,
      percentUsed: Number.isFinite(progress.percentUsed) ? progress.percentUsed : 999,
      level: progress.level,
      crossedThreshold: progress.crossedThreshold,
    },
    projection,
    createdAt: b.createdAt.toISOString(),
  };
}

export async function listBudgetDtos(auth: AuthContext, now = new Date()): Promise<BudgetDto[]> {
  const budgets = await Budget.find({ userId: auth.userId }).sort({ createdAt: 1 }).lean();
  return Promise.all(budgets.map((b) => toBudgetDto(auth, b, now)));
}

function periodKeyOf(window: ResolvedRange, period: BudgetDoc['period']): string {
  return period === 'monthly' ? window.fromDate.slice(0, 7) : `${period}:${window.fromDate}`;
}

/**
 * Fires an in-app alert the first time each configured threshold is crossed in a budget's current
 * period. Safe to call after any change to spending — repeated calls never duplicate alerts.
 */
export async function checkBudgetAlerts(auth: AuthContext, now = new Date()): Promise<void> {
  if (auth.prefs.notifications.budgetAlerts === false) return;
  const budgets = await Budget.find({ userId: auth.userId, isActive: true }).lean();
  for (const b of budgets) {
    const window = budgetWindow(auth, b, now);
    if (!window.inProgress && b.period === 'custom' && window.to < now) continue;
    const { netPaise } = await netSpend(auth, window, scopeOf(b));
    const progress = budgetProgress(netPaise, b.amountPaise, b.alertThresholds);
    const threshold = progress.crossedThreshold;
    if (threshold === null) continue;
    const periodKey = periodKeyOf(window, b.period);
    if (b.lastAlert && b.lastAlert.periodKey === periodKey && b.lastAlert.threshold >= threshold) continue;
    const exceeded = progress.level === 'exceeded';
    await notify(auth, {
      type: 'budget',
      severity: exceeded ? 'warning' : 'info',
      title: exceeded ? `${b.name} is over budget` : `${b.name} is at ${Math.round(progress.percentUsed)}%`,
      body: exceeded
        ? `You have spent ${formatINR(netPaise, { decimals: 'never' })} of ${formatINR(b.amountPaise, { decimals: 'never' })} (${formatINR(-progress.remainingPaise, { decimals: 'never' })} over).`
        : `${formatINR(netPaise, { decimals: 'never' })} of ${formatINR(b.amountPaise, { decimals: 'never' })} used — ${formatINR(progress.remainingPaise, { decimals: 'never' })} left.`,
      link: '/budgets',
      dedupeKey: `budget:${b._id.toString()}:${periodKey}:${threshold}`,
    });
    await Budget.updateOne({ _id: b._id, userId: auth.userId }, { $set: { lastAlert: { periodKey, threshold } } });
  }
}

export async function budgetHistory(auth: AuthContext, b: BudgetDoc, count = 6, now = new Date()): Promise<BudgetHistoryDto> {
  const windows: Array<{ key: string; label: string; from: Date; to: Date }> = [];
  if (b.period === 'monthly') {
    windows.push(...lastMonths(count, auth.tz, now));
  } else if (b.period === 'weekly') {
    const current = DateTime.fromJSDate(now, { zone: auth.tz }).startOf('day');
    const weekStart = current.minus({ days: auth.weekStartsOn === 1 ? current.weekday - 1 : current.weekday % 7 });
    for (let i = count - 1; i >= 0; i--) {
      const from = weekStart.minus({ weeks: i });
      windows.push({ key: from.toISODate() as string, label: from.toFormat('d LLL'), from: from.toUTC().toJSDate(), to: from.plus({ weeks: 1 }).toUTC().toJSDate() });
    }
  } else {
    const w = budgetWindow(auth, b, now);
    windows.push({ key: w.fromDate, label: w.label, from: w.from, to: w.to });
  }
  const points = await Promise.all(
    windows.map(async (w) => {
      const { netPaise } = await netSpend(auth, w, scopeOf(b));
      const p = budgetProgress(netPaise, b.amountPaise, b.alertThresholds);
      return { key: w.key, label: w.label, spentPaise: netPaise, amountPaise: b.amountPaise, percentUsed: Number.isFinite(p.percentUsed) ? p.percentUsed : 999, level: p.level };
    }),
  );
  return { id: b._id.toString(), points };
}

/** Suggested monthly budgets from the last few complete months of real spending. */
export async function suggestBudgets(auth: AuthContext, now = new Date()): Promise<BudgetSuggestionDto[]> {
  const months = lastMonths(4, auth.tz, now).slice(0, 3); // the three complete months before this one
  const span = { from: months[0]?.from ?? now, to: months[months.length - 1]?.to ?? now };
  const byCategory = await monthlyNetByCategory(auth, span);
  const monthKeys = months.map((m) => m.key);
  const existing = await Budget.find({ userId: auth.userId, isActive: true, period: 'monthly' }).lean();
  const haveOverall = existing.some((b) => b.scope === 'overall');
  const haveCategory = new Set(existing.filter((b) => b.scope === 'category').map((b) => b.category));

  const overallMonths = monthKeys.map((k) => [...byCategory.values()].reduce((s, m) => s + (m.get(k) ?? 0), 0));
  const out: BudgetSuggestionDto[] = [];
  const overall = suggestBudget(overallMonths);
  if (overall && !haveOverall) {
    out.push({ scope: 'overall', category: null, name: 'Monthly spending', amountPaise: overall.amountPaise, basis: overall.basis, basisMonths: overall.basisMonths, confidence: overall.confidence });
  }
  const perCategory = [...byCategory.entries()]
    .map(([slug, m]) => ({ slug, totals: monthKeys.map((k) => m.get(k) ?? 0) }))
    .filter((c) => !haveCategory.has(c.slug) && c.slug !== 'other')
    .map((c) => ({ ...c, s: suggestBudget(c.totals) }))
    .filter((c): c is typeof c & { s: NonNullable<typeof c.s> } => c.s !== null && c.s.amountPaise >= 100_000)
    .sort((a, b) => b.s.amountPaise - a.s.amountPaise)
    .slice(0, 5);
  for (const c of perCategory) {
    out.push({ scope: 'category', category: c.slug, name: categoryName(c.slug), amountPaise: c.s.amountPaise, basis: c.s.basis, basisMonths: c.s.basisMonths, confidence: c.s.confidence });
  }
  return out;
}


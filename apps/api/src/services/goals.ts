import { DateTime } from 'luxon';
import {
  categoryName,
  lastMonths,
  type GoalDto,
  type GoalScenarioDto,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import type { SavingsGoalDoc } from '../models/planning';
import { monthlyNetByCategory } from './analytics';

const monthsBetween = (from: DateTime, to: DateTime) => Math.max(0, to.startOf('day').diff(from.startOf('day'), 'months').months);

export function toGoalDto(auth: AuthContext, g: SavingsGoalDoc, now = new Date()): GoalDto {
  const today = DateTime.fromJSDate(now, { zone: auth.tz });
  const contributed = g.contributions.reduce((s, c) => s + c.amountPaise, 0);
  const saved = g.savedAmountPaise + contributed;
  const remaining = Math.max(0, g.targetAmountPaise - saved);
  const monthsLeft = Math.ceil(monthsBetween(today, DateTime.fromISO(g.targetDate, { zone: auth.tz })));
  const suggestedMonthly = remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft));

  const since = today.minus({ days: 90 }).toISODate() as string;
  const recent = g.contributions.filter((c) => c.date >= since);
  const recentMonthly = recent.length ? Math.round(recent.reduce((s, c) => s + c.amountPaise, 0) / 3) : null;
  const completed = remaining === 0;

  return {
    id: g._id.toString(),
    name: g.name,
    type: g.type,
    targetAmountPaise: g.targetAmountPaise,
    savedAmountPaise: saved,
    targetDate: g.targetDate,
    notes: g.notes,
    status: completed ? 'completed' : g.status,
    progressPct: Math.min(100, (saved / g.targetAmountPaise) * 100),
    remainingPaise: remaining,
    monthsLeft,
    suggestedMonthlyPaise: suggestedMonthly,
    recentMonthlyPaise: recentMonthly,
    onTrack: completed ? true : recentMonthly === null ? null : recentMonthly >= suggestedMonthly * 0.95,
    contributions: [...g.contributions]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((c) => ({ id: c._id.toString(), amountPaise: c.amountPaise, date: c.date, note: c.note })),
    createdAt: g.createdAt.toISOString(),
  };
}

/**
 * "What if I spent X% less on this category and put the difference towards the goal?" — an
 * estimate from the average of the last three complete months. Spendly never moves money; the
 * numbers only show how the timeline would change.
 */
export async function goalScenario(
  auth: AuthContext,
  g: SavingsGoalDoc,
  opts: { category: string; reducePct: number; plannedMonthlyPaise?: number },
  now = new Date(),
): Promise<GoalScenarioDto> {
  const dto = toGoalDto(auth, g, now);
  const months = lastMonths(4, auth.tz, now).slice(0, 3);
  const byCategory = await monthlyNetByCategory(auth, { from: months[0]?.from ?? now, to: months[months.length - 1]?.to ?? now });
  const monthTotals = months.map((m) => byCategory.get(opts.category)?.get(m.key) ?? 0);
  const active = monthTotals.filter((v) => v > 0);
  const currentMonthly = active.length ? Math.round(active.reduce((a, b) => a + b, 0) / active.length) : 0;
  const saving = Math.round((currentMonthly * opts.reducePct) / 100);
  const planned = opts.plannedMonthlyPaise ?? dto.recentMonthlyPaise ?? dto.suggestedMonthlyPaise;

  const monthsFor = (perMonth: number) => (dto.remainingPaise === 0 ? 0 : perMonth > 0 ? Math.ceil(dto.remainingPaise / perMonth) : null);
  const baseline = monthsFor(planned);
  const scenario = monthsFor(planned + saving);
  const finish = (m: number | null) => (m === null ? null : DateTime.fromJSDate(now, { zone: auth.tz }).plus({ months: m }).toISODate());

  const notes = [
    `Estimate based on your average ${categoryName(opts.category).toLowerCase()} spending of ${active.length} recent month${active.length === 1 ? '' : 's'}.`,
    'Assumes the saved amount is actually set aside for this goal each month — Spendly does not move any money.',
  ];
  if (active.length === 0) notes.unshift('There is no recent spending in this category, so a reduction would save nothing.');
  if (planned === 0) notes.push('Without a monthly contribution the goal has no completion date; the scenario shows what the saving alone would achieve.');

  return {
    goalId: dto.id,
    category: opts.category,
    categoryName: categoryName(opts.category),
    reducePct: opts.reducePct,
    currentMonthlyPaise: currentMonthly,
    monthlySavingPaise: saving,
    plannedMonthlyPaise: planned,
    monthsToGoalBaseline: baseline,
    monthsToGoalScenario: scenario,
    monthsSaved: baseline !== null && scenario !== null ? baseline - scenario : null,
    finishBaseline: finish(baseline),
    finishScenario: finish(scenario),
    notes,
  };
}

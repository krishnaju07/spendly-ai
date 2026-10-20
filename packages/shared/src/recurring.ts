import { DateTime } from 'luxon';
import { daysBetween, localDateKey } from './dates';
import { medianPaise } from './money';

/**
 * Recurring-payment detection from transaction history. Recurrence is *evidence*, not proof: a
 * merchant that is charged every month might be a subscription, a standing order, or just a habit
 * (Zomato every Friday). Each candidate therefore carries a confidence and the reasons behind it,
 * and the user confirms or dismisses it. A "next expected" date is only offered when the pattern
 * is regular enough to justify a reminder.
 */

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface RecurringInput {
  id: string;
  date: Date;
  amountPaise: number;
  merchantKey: string;
  merchantName: string;
  platform: string | null;
  category: string | null;
}

export interface RecurringCandidate {
  merchantKey: string;
  displayName: string;
  platform: string | null;
  category: string | null;
  frequency: RecurringFrequency;
  intervalDays: number;
  amountPaise: number;
  amountMinPaise: number;
  amountMaxPaise: number;
  amountVariable: boolean;
  occurrences: number;
  firstDate: Date;
  lastDate: Date;
  lastAmountPaise: number;
  nextExpectedDate: Date | null;
  possiblyInactive: boolean;
  priceChanges: Array<{ date: Date; fromPaise: number; toPaise: number }>;
  monthlyCostPaise: number;
  annualCostPaise: number;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  reasons: string[];
  transactionIds: string[];
}

const FREQUENCY_BANDS: Array<{ frequency: RecurringFrequency; min: number; max: number }> = [
  { frequency: 'weekly', min: 6, max: 8 },
  { frequency: 'biweekly', min: 13, max: 16 },
  { frequency: 'monthly', min: 26, max: 35 },
  { frequency: 'quarterly', min: 84, max: 98 },
  { frequency: 'half_yearly', min: 170, max: 195 },
  { frequency: 'yearly', min: 350, max: 380 },
];

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  half_yearly: 'Every 6 months',
  yearly: 'Yearly',
};

/** Habits that repeat often but are rarely subscriptions; they need unusually clean evidence. */
const HABIT_CATEGORIES = new Set(['food-delivery', 'groceries', 'dining-out', 'transport', 'fuel', 'shopping', 'cash', 'entertainment']);
const SUBSCRIPTION_CATEGORIES = new Set(['subscriptions']);
const OBLIGATION_CATEGORIES = new Set(['bills', 'rent', 'education', 'health']);

/** Charges per year for each cadence — cost estimates follow the cadence, not a particular month's length. */
const PER_YEAR: Record<RecurringFrequency, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

function classify(intervalDays: number): RecurringFrequency | null {
  const band = FREQUENCY_BANDS.find((b) => intervalDays >= b.min && intervalDays <= b.max);
  return band?.frequency ?? null;
}

function addInterval(date: Date, frequency: RecurringFrequency, tz: string): Date {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  const next =
    frequency === 'weekly'
      ? dt.plus({ days: 7 })
      : frequency === 'biweekly'
        ? dt.plus({ days: 14 })
        : frequency === 'monthly'
          ? dt.plus({ months: 1 })
          : frequency === 'quarterly'
            ? dt.plus({ months: 3 })
            : frequency === 'half_yearly'
              ? dt.plus({ months: 6 })
              : dt.plus({ years: 1 });
  return next.toUTC().toJSDate();
}

export function detectRecurring(
  transactions: readonly RecurringInput[],
  tz: string,
  now: Date = new Date(),
): RecurringCandidate[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of transactions) {
    const list = groups.get(t.merchantKey);
    if (list) list.push(t);
    else groups.set(t.merchantKey, [t]);
  }

  const out: RecurringCandidate[] = [];
  for (const [merchantKey, rows] of groups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

    // collapse same-day charges into one occurrence (keep the largest) so splits do not skew intervals
    const byDay = new Map<string, RecurringInput>();
    for (const t of sorted) {
      const key = localDateKey(t.date, tz);
      const existing = byDay.get(key);
      if (!existing || t.amountPaise > existing.amountPaise) byDay.set(key, t);
    }
    const days = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (days.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < days.length; i++) {
      intervals.push(daysBetween((days[i - 1] as RecurringInput).date, (days[i] as RecurringInput).date, tz));
    }
    const m = median(intervals);
    const frequency = classify(m);
    if (!frequency) continue;

    const longCycle = frequency === 'yearly' || frequency === 'half_yearly';
    if (days.length < 3 && !longCycle) continue;

    const tolerance = Math.max(2, Math.round(m * 0.12));
    let regularCredit = 0;
    for (const iv of intervals) {
      if (Math.abs(iv - m) <= tolerance) regularCredit += 1;
      else if (Math.abs(iv - 2 * m) <= tolerance * 1.5) regularCredit += 0.5; // a skipped cycle
    }
    const regularity = regularCredit / intervals.length;

    const amounts = days.map((d) => d.amountPaise);
    const typical = medianPaise(amounts);
    const stableCount = amounts.filter((a) => Math.abs(a - typical) <= typical * 0.1).length;
    const stability = stableCount / amounts.length;
    const amountVariable = stability < 0.6;

    const category = (days[days.length - 1] as RecurringInput).category;
    let prior = 0;
    const reasons: string[] = [];
    if (category && SUBSCRIPTION_CATEGORIES.has(category)) {
      prior = 0.15;
      reasons.push('Filed under Subscriptions');
    } else if (category && OBLIGATION_CATEGORIES.has(category)) {
      prior = 0.08;
    } else if (category && HABIT_CATEGORIES.has(category)) {
      if (stability >= 0.9 && regularity >= 0.8 && !amountVariable) {
        prior = -0.05;
        reasons.push('Usually a habit rather than a subscription — shown because amounts and dates are unusually regular');
      } else {
        prior = -0.3;
      }
    }

    const countScore = days.length >= 6 ? 0.3 : days.length === 5 ? 0.25 : days.length === 4 ? 0.2 : days.length === 3 ? 0.15 : 0.05;
    let confidence = 0.2 + countScore + 0.3 * regularity + 0.15 * stability + prior;
    if (days.length < 3) confidence = Math.min(confidence, 0.45);
    confidence = Math.max(0, Math.min(0.95, confidence));
    if (confidence < 0.45) continue;

    const last = days[days.length - 1] as RecurringInput;
    const first = days[0] as RecurringInput;
    const possiblyInactive = daysBetween(last.date, now, tz) > m * 1.8;

    const priceChanges: RecurringCandidate['priceChanges'] = [];
    if (!amountVariable) {
      let current = (days[0] as RecurringInput).amountPaise;
      for (let i = 1; i < days.length; i++) {
        const t = days[i] as RecurringInput;
        const next = days[i + 1];
        if (Math.abs(t.amountPaise - current) >= current * 0.03) {
          const confirmed = !next || Math.abs(next.amountPaise - t.amountPaise) <= t.amountPaise * 0.03;
          if (confirmed) {
            priceChanges.push({ date: t.date, fromPaise: current, toPaise: t.amountPaise });
            current = t.amountPaise;
          }
        }
      }
    }

    const canRemind = confidence >= 0.55 && regularity >= 0.6 && !possiblyInactive;
    const nextExpectedDate = canRemind ? addInterval(last.date, frequency, tz) : null;

    reasons.unshift(
      `${days.length} charges, typically every ${Math.round(m)} days (${Math.round(regularity * 100)}% on schedule)`,
    );
    reasons.push(
      amountVariable
        ? 'Amount changes from charge to charge, like a usage-based bill'
        : `Amount is steady around ₹${(typical / 100).toLocaleString('en-IN')}`,
    );
    if (possiblyInactive) reasons.push('No charge for a while — it may have been cancelled or paused');
    if (!canRemind && !possiblyInactive) reasons.push('Not regular enough to predict the next payment date');

    out.push({
      merchantKey,
      displayName: last.merchantName,
      platform: last.platform,
      category,
      frequency,
      intervalDays: Math.round(m),
      amountPaise: typical,
      amountMinPaise: Math.min(...amounts),
      amountMaxPaise: Math.max(...amounts),
      amountVariable,
      occurrences: days.length,
      firstDate: first.date,
      lastDate: last.date,
      lastAmountPaise: last.amountPaise,
      nextExpectedDate,
      possiblyInactive,
      priceChanges,
      monthlyCostPaise: Math.round((typical * PER_YEAR[frequency]) / 12),
      annualCostPaise: typical * PER_YEAR[frequency],
      confidence: Math.round(confidence * 100) / 100,
      confidenceLabel: confidence >= 0.75 ? 'high' : confidence >= 0.55 ? 'medium' : 'low',
      reasons,
      transactionIds: days.map((d) => d.id),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.annualCostPaise - a.annualCostPaise);
}

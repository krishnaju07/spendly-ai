import { DateTime } from 'luxon';
import type { Types } from 'mongoose';
import {
  FREQUENCY_LABELS,
  daysBetween,
  detectRecurring,
  type RecurringDto,
  type RecurringFrequency,
  type RecurringSummaryDto,
} from '@spendly/shared';
import type { AuthContext } from '../middleware/context';
import { Transaction } from '../models/finance';
import { RecurringPayment, type RecurringPaymentDoc } from '../models/planning';
import type { Lookups } from './lookups';
import { notify } from './notifications';

const LOOKBACK_MONTHS = 18;

/**
 * Re-runs recurrence detection and merges the result with what the user has already decided.
 * Confirmed and dismissed items keep their status; detected-but-vanished items are removed.
 */
export async function runRecurringDetection(auth: AuthContext, now = new Date()): Promise<number> {
  const since = DateTime.fromJSDate(now, { zone: auth.tz }).minus({ months: LOOKBACK_MONTHS }).toUTC().toJSDate();
  const base = { userId: auth.userId, type: 'expense', status: 'completed', date: { $gte: since } } as const;

  // only merchants charged at least twice can recur — find them first, then load just their rows
  const repeating = await Transaction.aggregate<{ _id: string }>([
    { $match: base },
    { $group: { _id: '$merchantKey', n: { $sum: 1 } } },
    { $match: { n: { $gte: 2 } } },
    { $limit: 3000 },
  ]);
  const keys = repeating.map((r) => r._id);
  const rows = keys.length
    ? await Transaction.find({ ...base, merchantKey: { $in: keys } })
        .select('date amountPaise merchantKey merchantName platform category')
        .lean()
    : [];

  const candidates = detectRecurring(
    rows.map((r) => ({
      id: r._id.toString(),
      date: r.date,
      amountPaise: r.amountPaise,
      merchantKey: r.merchantKey,
      merchantName: r.merchantName,
      platform: r.platform,
      category: r.category,
    })),
    auth.tz,
    now,
  );

  const existing = new Map((await RecurringPayment.find({ userId: auth.userId }).lean()).map((e) => [e.merchantKey, e]));
  const detectedKeys = new Set(candidates.map((c) => c.merchantKey));

  const ops = candidates.map((c) => {
    const prior = existing.get(c.merchantKey);
    const set = {
      displayName: c.displayName,
      platform: c.platform,
      category: c.category,
      frequency: c.frequency,
      intervalDays: c.intervalDays,
      amountPaise: c.amountPaise,
      amountMinPaise: c.amountMinPaise,
      amountMaxPaise: c.amountMaxPaise,
      amountVariable: c.amountVariable,
      occurrences: c.occurrences,
      firstDate: c.firstDate,
      lastDate: c.lastDate,
      lastAmountPaise: c.lastAmountPaise,
      nextExpectedDate: c.nextExpectedDate,
      possiblyInactive: c.possiblyInactive,
      priceChanges: c.priceChanges,
      monthlyCostPaise: c.monthlyCostPaise,
      annualCostPaise: c.annualCostPaise,
      confidence: c.confidence,
      reasons: c.reasons,
      transactionIds: c.transactionIds,
      lastDetectedAt: now,
    };
    return {
      updateOne: {
        filter: { userId: auth.userId, merchantKey: c.merchantKey },
        update: { $set: set, $setOnInsert: { status: prior?.status ?? 'detected', reminderDaysBefore: 2 } },
        upsert: true,
      },
    };
  });
  if (ops.length) await RecurringPayment.bulkWrite(ops);

  // detected-only items that are no longer supported by the data disappear; decisions are never discarded
  await RecurringPayment.deleteMany({ userId: auth.userId, status: 'detected', merchantKey: { $nin: [...detectedKeys] } });

  // tag the underlying transactions so the ledger can show a "recurring" badge
  const live = await RecurringPayment.find({ userId: auth.userId, status: { $ne: 'dismissed' } }).select('_id transactionIds').lean();
  await Transaction.updateMany({ userId: auth.userId, recurringPaymentId: { $ne: null } }, { $set: { recurringPaymentId: null } });
  await Promise.all(
    live.map((r) => Transaction.updateMany({ userId: auth.userId, _id: { $in: r.transactionIds } }, { $set: { recurringPaymentId: r._id } })),
  );
  return candidates.length;
}

export function toRecurringDto(r: RecurringPaymentDoc, lk: Lookups, tz: string, now = new Date()): RecurringDto {
  const amount = r.overrides.amountPaise ?? r.amountPaise;
  const scale = amount / Math.max(1, r.amountPaise);
  const next = r.overrides.nextExpectedDate ?? r.nextExpectedDate;
  const confidence = r.confidence;
  return {
    id: r._id.toString(),
    merchantKey: r.merchantKey,
    displayName: r.displayName,
    platform: r.platform,
    platformName: lk.platformName(r.platform),
    category: r.category,
    frequency: r.frequency as RecurringFrequency,
    frequencyLabel: FREQUENCY_LABELS[r.frequency as RecurringFrequency] ?? r.frequency,
    intervalDays: r.intervalDays,
    amountPaise: amount,
    amountMinPaise: r.amountMinPaise,
    amountMaxPaise: r.amountMaxPaise,
    amountVariable: r.amountVariable,
    occurrences: r.occurrences,
    firstDate: r.firstDate.toISOString(),
    lastDate: r.lastDate.toISOString(),
    lastAmountPaise: r.lastAmountPaise,
    nextExpectedDate: next?.toISOString() ?? null,
    daysUntilNext: next ? daysBetween(now, next, tz) : null,
    possiblyInactive: r.possiblyInactive,
    priceChanges: r.priceChanges.map((p) => ({ date: p.date.toISOString(), fromPaise: p.fromPaise, toPaise: p.toPaise })),
    monthlyCostPaise: Math.round(r.monthlyCostPaise * scale),
    annualCostPaise: Math.round(r.annualCostPaise * scale),
    confidence,
    confidenceLabel: confidence >= 0.75 ? 'high' : confidence >= 0.55 ? 'medium' : 'low',
    reasons: r.reasons,
    status: r.status,
    reminderDaysBefore: r.reminderDaysBefore,
  };
}

export async function recurringSummary(auth: AuthContext, lk: Lookups, now = new Date()): Promise<RecurringSummaryDto> {
  const docs = await RecurringPayment.find({ userId: auth.userId }).sort({ annualCostPaise: -1 }).lean();
  const items = docs.map((d) => toRecurringDto(d, lk, auth.tz, now));
  const sum = (status: RecurringDto['status'], key: 'monthlyCostPaise' | 'annualCostPaise') =>
    items.filter((i) => i.status === status).reduce((s, i) => s + i[key], 0);
  const last = docs.reduce<Date | null>((m, d) => (!m || d.lastDetectedAt > m ? d.lastDetectedAt : m), null);
  return {
    items,
    totals: {
      confirmedCount: items.filter((i) => i.status === 'confirmed').length,
      confirmedMonthlyPaise: sum('confirmed', 'monthlyCostPaise'),
      confirmedAnnualPaise: sum('confirmed', 'annualCostPaise'),
      detectedCount: items.filter((i) => i.status === 'detected').length,
      detectedMonthlyPaise: sum('detected', 'monthlyCostPaise'),
      detectedAnnualPaise: sum('detected', 'annualCostPaise'),
    },
    lastDetectedAt: last?.toISOString() ?? null,
  };
}

/** Upcoming-payment reminders — only for payments the user confirmed and whose date can be estimated. */
export async function ensureUpcomingReminders(auth: AuthContext, lk: Lookups, now = new Date()): Promise<void> {
  if (auth.prefs.notifications.upcomingPayments === false) return;
  const docs = await RecurringPayment.find({ userId: auth.userId, status: 'confirmed', nextExpectedDate: { $ne: null } }).lean();
  for (const d of docs) {
    const next = d.overrides.nextExpectedDate ?? d.nextExpectedDate;
    if (!next || d.possiblyInactive) continue;
    const days = daysBetween(now, next, auth.tz);
    if (days < 0 || days > d.reminderDaysBefore) continue;
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    await notify(auth, {
      type: 'upcoming_payment',
      title: `${d.displayName} is expected ${when}`,
      body: `Usually about ₹${Math.round((d.overrides.amountPaise ?? d.amountPaise) / 100).toLocaleString('en-IN')}. This is an estimate from your past payments.`,
      link: '/recurring',
      dedupeKey: `recurring:${d._id.toString()}:${DateTime.fromJSDate(next, { zone: auth.tz }).toISODate()}`,
    });
  }
  void lk;
}

export type { Types };

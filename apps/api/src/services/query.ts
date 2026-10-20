import type { QueryFilter } from 'mongoose';
import { z, type ZodType } from 'zod';
import {
  InvalidRangeError,
  PAYMENT_METHODS,
  RANGE_PRESETS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  isoDay,
  previousPeriod,
  resolveRange,
  type ComparisonRange,
  type ResolvedRange,
  type RangeDto,
  type BaselineRangeDto,
} from '@spendly/shared';
import { badRequest } from '../lib/errors';
import type { AuthContext } from '../middleware/context';
import type { TransactionDoc } from '../models/finance';

/** "a,b,c" → ["a","b","c"], validated item by item. */
export const csv = <T extends ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(item).max(30),
  );

const slugOrNone = z.union([z.literal('none'), z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)]);

export const rangeQuery = z.object({
  preset: z.enum(RANGE_PRESETS).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
});

export const filterQuery = z.object({
  category: csv(slugOrNone).optional(),
  platform: csv(slugOrNone).optional(),
  paymentMethod: csv(z.enum(PAYMENT_METHODS)).optional(),
  type: csv(z.enum(TRANSACTION_TYPES)).optional(),
  status: csv(z.enum(TRANSACTION_STATUSES)).optional(),
});

export type RangeQuery = z.infer<typeof rangeQuery>;
export type FilterQueryInput = z.infer<typeof filterQuery>;

export function rangesFor(auth: AuthContext, q: RangeQuery, now = new Date()): { range: ResolvedRange; baseline: ComparisonRange } {
  try {
    const preset = q.preset ?? (q.from || q.to ? 'custom' : (auth.prefs.defaultRange as RangeQuery['preset']));
    const range = resolveRange({ preset, from: q.from, to: q.to }, auth.tz, now, { weekStartsOn: auth.weekStartsOn });
    return { range, baseline: previousPeriod(range, now) };
  } catch (error) {
    if (error instanceof InvalidRangeError) throw badRequest(error.message, undefined, 'INVALID_RANGE');
    throw error;
  }
}

export const rangeDto = (r: ResolvedRange): RangeDto => ({
  preset: r.preset,
  from: r.from.toISOString(),
  to: r.to.toISOString(),
  fromDate: r.fromDate,
  toDate: r.toDate,
  days: r.days,
  elapsedDays: r.elapsedDays,
  inProgress: r.inProgress,
  label: r.label,
  timezone: r.timezone,
});

export const baselineDto = (r: ComparisonRange): BaselineRangeDto => ({ ...rangeDto(r), baselineLabel: r.baselineLabel });

const nullable = (values: string[]) => values.map((v) => (v === 'none' ? null : v));

/** Mongo filter for a user's transactions. Every query in the app starts here, so ownership is never optional. */
export function buildMatch(
  auth: AuthContext,
  opts: {
    range?: { from: Date; to: Date };
    filters?: FilterQueryInput;
    /** Analytics count completed transactions only; the ledger view shows every status. */
    statuses?: readonly string[];
    types?: readonly string[];
  } = {},
): QueryFilter<TransactionDoc> {
  const match: QueryFilter<TransactionDoc> = { userId: auth.userId };
  if (opts.range) match.date = { $gte: opts.range.from, $lt: opts.range.to };
  const f = opts.filters;
  if (f?.category?.length) match.category = { $in: nullable(f.category) };
  if (f?.platform?.length) match.platform = { $in: nullable(f.platform) };
  if (f?.paymentMethod?.length) match.paymentMethod = { $in: f.paymentMethod };
  const types = f?.type?.length ? f.type : opts.types;
  if (types?.length) match.type = { $in: [...types] } as QueryFilter<TransactionDoc>['type'];
  const statuses = f?.status?.length ? f.status : opts.statuses;
  if (statuses?.length) match.status = { $in: [...statuses] } as QueryFilter<TransactionDoc>['status'];
  return match;
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const objectIdParam = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

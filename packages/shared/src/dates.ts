import { DateTime, IANAZone } from 'luxon';

/**
 * All range maths happens in the user's IANA timezone so "this month" means the same thing as the
 * calendar on their wall. Ranges are half-open UTC instants: [from, to).
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'this_fy',
  'last_fy',
  'last_12_months',
  'custom',
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type RangeUnit = 'week' | 'month' | 'quarter' | 'year' | 'fy';

export interface DateRangeInput {
  preset?: RangePreset;
  /** Inclusive local date, YYYY-MM-DD. */
  from?: string;
  /** Inclusive local date, YYYY-MM-DD. */
  to?: string;
}

export interface ResolvedRange {
  preset: RangePreset;
  from: Date;
  /** Exclusive end instant. */
  to: Date;
  fromDate: string;
  /** Inclusive last local day. */
  toDate: string;
  days: number;
  /** Days of the range that have already started (today included), capped at `days`. */
  elapsedDays: number;
  inProgress: boolean;
  label: string;
  timezone: string;
  unit: RangeUnit | null;
}

export class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRangeError';
  }
}

export interface RangeOptions {
  /** 1 = Monday (default), 7 = Sunday. */
  weekStartsOn?: 1 | 7;
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This year',
  last_year: 'Last year',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  last_12_months: 'Last 12 months',
  custom: 'Custom range',
};

function zoned(date: Date | string, tz: string): DateTime {
  const dt =
    typeof date === 'string' ? DateTime.fromISO(date, { zone: tz }) : DateTime.fromJSDate(date, { zone: tz });
  if (!dt.isValid) throw new InvalidRangeError(`Invalid date: ${String(date)}`);
  return dt;
}

function startOfWeek(dt: DateTime, weekStartsOn: 1 | 7): DateTime {
  const day = dt.startOf('day');
  const offset = weekStartsOn === 1 ? day.weekday - 1 : day.weekday % 7;
  return day.minus({ days: offset });
}

/** Indian financial year start (1 April) containing `dt`. */
function startOfFinancialYear(dt: DateTime): DateTime {
  const base = dt.startOf('month');
  const year = base.month >= 4 ? base.year : base.year - 1;
  return base.set({ year, month: 4 });
}

function calendarDays(from: DateTime, to: DateTime): number {
  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days);
}

export function formatRangeLabel(fromDate: string, toDate: string, tz: string): string {
  const from = DateTime.fromISO(fromDate, { zone: tz });
  const to = DateTime.fromISO(toDate, { zone: tz });
  if (fromDate === toDate) return from.toFormat('d LLL yyyy');
  if (from.year === to.year) {
    return from.month === to.month
      ? `${from.toFormat('d')} – ${to.toFormat('d LLL yyyy')}`
      : `${from.toFormat('d LLL')} – ${to.toFormat('d LLL yyyy')}`;
  }
  return `${from.toFormat('d LLL yyyy')} – ${to.toFormat('d LLL yyyy')}`;
}

function build(
  preset: RangePreset,
  from: DateTime,
  toExclusive: DateTime,
  tz: string,
  now: DateTime,
  unit: RangeUnit | null,
  label?: string,
): ResolvedRange {
  const days = Math.max(1, calendarDays(from, toExclusive));
  const toDate = toExclusive.minus({ days: 1 }).toISODate() as string;
  const fromDate = from.toISODate() as string;
  const tomorrow = now.startOf('day').plus({ days: 1 });
  const inProgress = toExclusive > tomorrow;
  const elapsed = inProgress ? Math.max(1, Math.min(days, calendarDays(from, tomorrow))) : days;
  return {
    preset,
    from: from.toUTC().toJSDate(),
    to: toExclusive.toUTC().toJSDate(),
    fromDate,
    toDate,
    days,
    elapsedDays: from > now ? 0 : elapsed,
    inProgress,
    label: label ?? PRESET_LABELS[preset],
    timezone: tz,
    unit,
  };
}

export function resolveRange(
  input: DateRangeInput,
  tz: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
  opts: RangeOptions = {},
): ResolvedRange {
  if (!isValidTimezone(tz)) throw new InvalidRangeError(`Unknown timezone: ${tz}`);
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const n = zoned(now, tz);
  const today = n.startOf('day');
  const tomorrow = today.plus({ days: 1 });
  const preset: RangePreset = input.preset ?? (input.from || input.to ? 'custom' : 'this_month');

  switch (preset) {
    case 'today':
      return build(preset, today, tomorrow, tz, n, null);
    case 'yesterday':
      return build(preset, today.minus({ days: 1 }), today, tz, n, null);
    case 'last_7_days':
      return build(preset, today.minus({ days: 6 }), tomorrow, tz, n, null);
    case 'last_30_days':
      return build(preset, today.minus({ days: 29 }), tomorrow, tz, n, null);
    case 'last_90_days':
      return build(preset, today.minus({ days: 89 }), tomorrow, tz, n, null);
    case 'this_week': {
      const start = startOfWeek(n, weekStartsOn);
      return build(preset, start, start.plus({ days: 7 }), tz, n, 'week');
    }
    case 'last_week': {
      const start = startOfWeek(n, weekStartsOn).minus({ days: 7 });
      return build(preset, start, start.plus({ days: 7 }), tz, n, 'week');
    }
    case 'this_month': {
      const start = n.startOf('month');
      return build(preset, start, start.plus({ months: 1 }), tz, n, 'month');
    }
    case 'last_month': {
      const start = n.startOf('month').minus({ months: 1 });
      return build(preset, start, start.plus({ months: 1 }), tz, n, 'month');
    }
    case 'this_quarter': {
      const start = n.startOf('quarter');
      return build(preset, start, start.plus({ months: 3 }), tz, n, 'quarter');
    }
    case 'last_quarter': {
      const start = n.startOf('quarter').minus({ months: 3 });
      return build(preset, start, start.plus({ months: 3 }), tz, n, 'quarter');
    }
    case 'this_year': {
      const start = n.startOf('year');
      return build(preset, start, start.plus({ years: 1 }), tz, n, 'year');
    }
    case 'last_year': {
      const start = n.startOf('year').minus({ years: 1 });
      return build(preset, start, start.plus({ years: 1 }), tz, n, 'year');
    }
    case 'this_fy': {
      const start = startOfFinancialYear(n);
      return build(preset, start, start.plus({ years: 1 }), tz, n, 'fy');
    }
    case 'last_fy': {
      const start = startOfFinancialYear(n).minus({ years: 1 });
      return build(preset, start, start.plus({ years: 1 }), tz, n, 'fy');
    }
    case 'last_12_months': {
      const start = n.startOf('month').minus({ months: 11 });
      return build(preset, start, n.startOf('month').plus({ months: 1 }), tz, n, null);
    }
    case 'custom': {
      if (!input.from || !input.to) {
        throw new InvalidRangeError('A custom range needs both "from" and "to" dates');
      }
      return customRange(input.from, input.to, tz, now);
    }
  }
}

export function customRange(
  fromDate: string,
  toDate: string,
  tz: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): ResolvedRange {
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDay.test(fromDate) || !isoDay.test(toDate)) {
    throw new InvalidRangeError('Dates must use the YYYY-MM-DD format');
  }
  const from = zoned(fromDate, tz).startOf('day');
  const toIncl = zoned(toDate, tz).startOf('day');
  if (toIncl < from) throw new InvalidRangeError('"to" must not be before "from"');
  if (calendarDays(from, toIncl) > 366 * 5) throw new InvalidRangeError('Range is longer than 5 years');
  const n = zoned(now, tz);
  const label = formatRangeLabel(fromDate, toDate, tz);
  const monthAligned =
    from.day === 1 && from.hasSame(toIncl, 'month') && toIncl >= from;
  return build('custom', from, toIncl.plus({ days: 1 }), tz, n, monthAligned ? 'month' : null, label);
}

export interface ComparisonRange extends ResolvedRange {
  /** Human label for the comparison baseline, e.g. "Same days last month". */
  baselineLabel: string;
}

/**
 * The baseline a range should be compared against.
 *  - Calendar-aligned ranges compare with the previous calendar period. While the current period
 *    is still in progress the baseline covers the same number of days (like-for-like), so the
 *    10th of March is compared with 1–10 February rather than all of February.
 *  - Rolling and custom ranges compare with the equally long range immediately before them.
 */
export function previousPeriod(range: ResolvedRange, now: Date = new Date()): ComparisonRange {
  const tz = range.timezone;
  const from = zoned(range.from, tz);
  const n = zoned(now, tz);

  if (range.unit) {
    const step =
      range.unit === 'week'
        ? { weeks: 1 }
        : range.unit === 'month'
          ? { months: 1 }
          : range.unit === 'quarter'
            ? { months: 3 }
            : { years: 1 };
    const prevFrom = from.minus(step);
    const prevFullEnd = from;
    const prevTo = range.inProgress
      ? DateTime.min(prevFrom.plus({ days: range.elapsedDays }), prevFullEnd)
      : prevFullEnd;
    const unitLabel = range.unit === 'fy' ? 'financial year' : range.unit;
    const resolved = build('custom', prevFrom, prevTo, tz, n, null, undefined);
    resolved.label = formatRangeLabel(resolved.fromDate, resolved.toDate, tz);
    return {
      ...resolved,
      baselineLabel: range.inProgress ? `Same days last ${unitLabel}` : `Previous ${unitLabel}`,
    };
  }

  const length = Math.max(1, range.days);
  const prevFrom = from.minus({ days: length });
  const resolved = build('custom', prevFrom, from, tz, n, null);
  resolved.label = formatRangeLabel(resolved.fromDate, resolved.toDate, tz);
  return { ...resolved, baselineLabel: `Previous ${length} days` };
}

export interface MonthBucket {
  key: string;
  label: string;
  from: Date;
  to: Date;
}

/** The last `count` calendar months ending with the month containing `now`, oldest first. */
export function lastMonths(count: number, tz: string, now: Date = new Date()): MonthBucket[] {
  const current = zoned(now, tz).startOf('month');
  const out: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = current.minus({ months: i });
    out.push({
      key: start.toFormat('yyyy-LL'),
      label: start.toFormat('LLL yyyy'),
      from: start.toUTC().toJSDate(),
      to: start.plus({ months: 1 }).toUTC().toJSDate(),
    });
  }
  return out;
}

export function monthRange(key: string, tz: string): { from: Date; to: Date } {
  const start = DateTime.fromFormat(key, 'yyyy-LL', { zone: tz });
  if (!start.isValid) throw new InvalidRangeError(`Invalid month key: ${key}`);
  return { from: start.toUTC().toJSDate(), to: start.plus({ months: 1 }).toUTC().toJSDate() };
}

export function startOfLocalDay(date: Date, tz: string): Date {
  return zoned(date, tz).startOf('day').toUTC().toJSDate();
}

export function localDateKey(date: Date, tz: string): string {
  return zoned(date, tz).toISODate() as string;
}

export function localMonthKey(date: Date, tz: string): string {
  return zoned(date, tz).toFormat('yyyy-LL');
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  dateKey: string;
}

export function localParts(date: Date, tz: string): LocalParts {
  const dt = zoned(date, tz);
  return {
    year: dt.year,
    month: dt.month,
    day: dt.day,
    hour: dt.hour,
    weekday: dt.weekday,
    dateKey: dt.toISODate() as string,
  };
}

export function isWeekend(date: Date, tz: string): boolean {
  return zoned(date, tz).weekday >= 6;
}

/** Whole calendar days from a to b in the given timezone (negative if b is earlier). */
export function daysBetween(a: Date, b: Date, tz: string): number {
  return calendarDays(zoned(a, tz), zoned(b, tz));
}

export function addDays(date: Date, days: number, tz: string): Date {
  return zoned(date, tz).plus({ days }).toUTC().toJSDate();
}

export function addMonths(date: Date, months: number, tz: string): Date {
  return zoned(date, tz).plus({ months }).toUTC().toJSDate();
}

/** Build a UTC instant from a local calendar date (+ optional wall-clock time) in `tz`. */
export function fromLocal(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  tz: string,
): Date | null {
  const dt = DateTime.fromObject(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour ?? 12,
      minute: parts.minute ?? 0,
      second: parts.second ?? 0,
    },
    { zone: tz },
  );
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

export function daysInMonth(year: number, month: number): number {
  return DateTime.fromObject({ year, month }, { zone: 'UTC' }).daysInMonth ?? 30;
}

/** Number of days in the local month containing `date`. */
export function daysInLocalMonth(date: Date, tz: string): number {
  return zoned(date, tz).daysInMonth ?? 30;
}

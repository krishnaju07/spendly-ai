import { DateTime } from 'luxon';
import { DEFAULT_TIMEZONE } from './dates';

/**
 * Tolerant date parsing for statement imports. Dates without a time are anchored to 12:00 local so
 * they can never slip across a day boundary when the timezone or the display changes; the
 * `hasTime` flag records whether the time of day is real (time-of-day insights only trust those).
 */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export type ParsedDate = { ok: true; date: Date; hasTime: boolean } | { ok: false; reason: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const TIME = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\.\\d+)?\\s*([AaPp]\\.?[Mm]\\.?)?';
const NUMERIC = new RegExp(`^(\\d{1,4})[/\\-.](\\d{1,2})[/\\-.](\\d{1,4})(?:[ T,]+${TIME})?$`);
const DAY_MONTH_NAME = new RegExp(`^(\\d{1,2})[ \\-/.]([A-Za-z]{3,9})\\.?[ \\-/.,]+(\\d{2,4})(?:[ T,]+${TIME})?$`);
const MONTH_NAME_DAY = new RegExp(`^([A-Za-z]{3,9})\\.? (\\d{1,2}),? (\\d{4})(?:[ T,]+${TIME})?$`);
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;

function expandYear(y: number, raw: string): number {
  if (raw.length > 2) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function timeParts(h?: string, m?: string, s?: string, meridiem?: string) {
  if (h === undefined || m === undefined) return { hour: 12, minute: 0, second: 0, hasTime: false };
  let hour = Number(h);
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p');
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  const minute = Number(m);
  const second = s ? Number(s) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // midnight-only values are almost always "no time" exports; treat 00:00:00 as date-only
  const hasTime = !(hour === 0 && minute === 0 && second === 0);
  return { hour: hasTime ? hour : 12, minute, second, hasTime };
}

function build(y: number, mo: number, d: number, time: ReturnType<typeof timeParts>, tz: string): ParsedDate {
  if (!time) return { ok: false, reason: 'Invalid time of day' };
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: d, hour: time.hour, minute: time.minute, second: time.second },
    { zone: tz },
  );
  if (!dt.isValid) return { ok: false, reason: `Not a real calendar date (${d}/${mo}/${y})` };
  return { ok: true, date: dt.toUTC().toJSDate(), hasTime: time.hasTime };
}

/**
 * Decide day-first vs month-first from a column of sample values. Indian statements are day-first,
 * so ambiguity (every value ≤ 12) resolves to "dmy".
 */
export function detectDateOrder(samples: readonly string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(s.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if ((m[1] as string).length === 4) return 'ymd';
    if (a > 12) dmy++;
    else if (b > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/** Excel serial day number (1900 system) -> local calendar date. */
function fromExcelSerial(serial: number, tz: string): ParsedDate {
  if (serial < 20000 || serial > 80000) return { ok: false, reason: `"${serial}" is not a plausible date` };
  const whole = Math.floor(serial);
  const frac = serial - whole;
  const base = DateTime.fromObject({ year: 1899, month: 12, day: 30 }, { zone: 'UTC' }).plus({ days: whole });
  const seconds = Math.round(frac * 86400);
  const hasTime = seconds > 0;
  return build(
    base.year,
    base.month,
    base.day,
    hasTime
      ? { hour: Math.floor(seconds / 3600), minute: Math.floor((seconds % 3600) / 60), second: seconds % 60, hasTime: true }
      : { hour: 12, minute: 0, second: 0, hasTime: false },
    tz,
  );
}

export function parseDateValue(
  input: string | number | Date,
  opts: { tz?: string; order?: DateOrder } = {},
): ParsedDate {
  const tz = opts.tz ?? DEFAULT_TIMEZONE;
  const order = opts.order ?? 'dmy';

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, reason: 'Invalid date' };
    // Spreadsheet libraries hand back wall-clock values as UTC; read them as the user's local time.
    const hasTime = input.getUTCHours() + input.getUTCMinutes() + input.getUTCSeconds() > 0;
    return build(
      input.getUTCFullYear(),
      input.getUTCMonth() + 1,
      input.getUTCDate(),
      hasTime
        ? { hour: input.getUTCHours(), minute: input.getUTCMinutes(), second: input.getUTCSeconds(), hasTime: true }
        : { hour: 12, minute: 0, second: 0, hasTime: false },
      tz,
    );
  }
  if (typeof input === 'number') return fromExcelSerial(input, tz);

  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return { ok: false, reason: 'Date is empty' };
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s), tz);

  if (ISO_WITH_ZONE.test(s)) {
    const dt = DateTime.fromISO(s.replace(' ', 'T'), { setZone: false });
    return dt.isValid ? { ok: true, date: dt.toUTC().toJSDate(), hasTime: true } : { ok: false, reason: 'Invalid timestamp' };
  }

  const numeric = NUMERIC.exec(s);
  if (numeric) {
    const [, p1, p2, p3, h, mi, sec, mer] = numeric;
    const n1 = Number(p1);
    const n2 = Number(p2);
    const n3 = Number(p3);
    const time = timeParts(h, mi, sec, mer);
    if ((p1 as string).length === 4) return build(n1, n2, n3, time, tz);
    const year = expandYear(n3, p3 as string);
    return order === 'mdy' ? build(year, n1, n2, time, tz) : build(year, n2, n1, time, tz);
  }

  const dayMonth = DAY_MONTH_NAME.exec(s);
  if (dayMonth) {
    const [, d, mon, y, h, mi, sec, mer] = dayMonth;
    const month = MONTHS[(mon as string).toLowerCase()];
    if (!month) return { ok: false, reason: `Unknown month "${mon}"` };
    return build(expandYear(Number(y), y as string), month, Number(d), timeParts(h, mi, sec, mer), tz);
  }

  const monthDay = MONTH_NAME_DAY.exec(s);
  if (monthDay) {
    const [, mon, d, y, h, mi, sec, mer] = monthDay;
    const month = MONTHS[(mon as string).toLowerCase()];
    if (!month) return { ok: false, reason: `Unknown month "${mon}"` };
    return build(Number(y), month, Number(d), timeParts(h, mi, sec, mer), tz);
  }

  return { ok: false, reason: `Unrecognised date format "${input}"` };
}

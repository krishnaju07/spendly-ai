/**
 * Money is stored and computed as integer paise (1 INR = 100 paise). Floating point is only ever
 * used for display. Parsing is string-based so "1,234.50" never passes through a float.
 */

export const PAISE_PER_RUPEE = 100;
/** ₹100 crore in paise — anything above this is treated as a data error, not a transaction. */
export const MAX_AMOUNT_PAISE = 100_00_00_000 * PAISE_PER_RUPEE;

export type MoneyParseErrorCode = 'EMPTY' | 'INVALID' | 'TOO_MANY_DECIMALS' | 'OUT_OF_RANGE';

export class MoneyParseError extends Error {
  constructor(
    public readonly code: MoneyParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

export interface ParsedAmount {
  /** Absolute value in paise (always a non-negative integer). */
  paise: number;
  /** True when the source text carried a minus sign or was wrapped in parentheses. */
  negative: boolean;
  /** Explicit debit/credit marker found in the text, if any. */
  drcr: 'DR' | 'CR' | null;
  /** ISO currency code when the text states one that is not INR (e.g. "USD 12.00"). */
  foreignCurrency: string | null;
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00A0]/g;
const FOREIGN_CURRENCY = /\b(USD|EUR|GBP|AED|SGD|AUD|CAD|JPY)\b|[$€£]/i;
const SYMBOL_TO_CODE: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

function exactPaiseFromNumber(n: number): number {
  if (!Number.isFinite(n)) throw new MoneyParseError('INVALID', 'Amount is not a finite number');
  const paise = Math.round(n * PAISE_PER_RUPEE);
  // Spreadsheet floats carry binary noise (249.99000000000001); real third decimals do not.
  if (Math.abs(n * PAISE_PER_RUPEE - paise) > 1e-6 * Math.max(1, Math.abs(paise))) {
    throw new MoneyParseError('TOO_MANY_DECIMALS', 'Amounts can have at most 2 decimal places');
  }
  return paise;
}

/**
 * Parse an amount from text or a number. Accepts Indian and western grouping, ₹/Rs/INR prefixes,
 * "/-" suffixes, parentheses or a leading/trailing minus for negatives, and Dr/Cr markers.
 */
export function parseAmount(input: string | number): ParsedAmount {
  if (typeof input === 'number') {
    const paise = exactPaiseFromNumber(input);
    if (Math.abs(paise) > MAX_AMOUNT_PAISE) {
      throw new MoneyParseError('OUT_OF_RANGE', 'Amount is unrealistically large');
    }
    return { paise: Math.abs(paise), negative: paise < 0, drcr: null, foreignCurrency: null };
  }

  // "350/-" is Indian "rupees only" notation; strip it before sign detection or it reads as a minus.
  let text = input
    .replace(ZERO_WIDTH, ' ')
    .replace(/\/-/g, ' ')
    .trim();
  if (!text) throw new MoneyParseError('EMPTY', 'Amount is empty');

  let foreignCurrency: string | null = null;
  const foreign = FOREIGN_CURRENCY.exec(text);
  if (foreign) {
    foreignCurrency = (SYMBOL_TO_CODE[foreign[0]] ?? foreign[0]).toUpperCase();
    text = text.replace(FOREIGN_CURRENCY, ' ');
  }

  let drcr: 'DR' | 'CR' | null = null;
  text = text.replace(/\b(DR|CR)\b\.?/i, (_, marker: string) => {
    drcr = marker.toUpperCase() as 'DR' | 'CR';
    return ' ';
  });

  let negative = false;
  text = text.replace(/−/g, '-');
  const wrapped = /^\((.*)\)$/.exec(text.trim());
  if (wrapped?.[1] !== undefined) {
    negative = true;
    text = wrapped[1];
  }
  if (/^\s*-/.test(text) || /-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/^\s*-|-\s*$/g, '');
  }

  text = text
    .replace(/₹|\bINR\b|\bRS\b\.?/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  if (!text) throw new MoneyParseError('EMPTY', 'Amount is empty');

  if (!/^\d{1,3}(,\d{2,3})*(\.\d+)?$|^\d*\.?\d+$/.test(text)) {
    throw new MoneyParseError('INVALID', `"${input}" is not a valid amount`);
  }
  const [intRaw = '0', fracRaw = ''] = text.replace(/,/g, '').split('.');
  const frac = fracRaw.replace(/0+$/, '');
  if (frac.length > 2) {
    throw new MoneyParseError('TOO_MANY_DECIMALS', 'Amounts can have at most 2 decimal places');
  }
  const rupees = Number.parseInt(intRaw === '' ? '0' : intRaw, 10);
  const paise = rupees * PAISE_PER_RUPEE + Number.parseInt((frac + '00').slice(0, 2), 10);
  if (!Number.isSafeInteger(paise) || paise > MAX_AMOUNT_PAISE) {
    throw new MoneyParseError('OUT_OF_RANGE', 'Amount is unrealistically large');
  }
  return { paise, negative, drcr, foreignCurrency };
}

/** Parse a user-typed rupee amount (form input) into positive paise. Throws MoneyParseError. */
export function rupeesToPaise(input: string | number): number {
  const parsed = parseAmount(input);
  if (parsed.foreignCurrency) {
    throw new MoneyParseError('INVALID', `Only INR is supported (found ${parsed.foreignCurrency})`);
  }
  return parsed.paise;
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

export function isValidPaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT_PAISE;
}

export function sumPaise(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Integer average, rounded half away from zero. Returns 0 for an empty set. */
export function averagePaise(total: number, count: number): number {
  if (count <= 0) return 0;
  const avg = total / count;
  return avg < 0 ? -Math.round(-avg) : Math.round(avg);
}

/** Median of integer paise values (even-length sets average the two middle values, rounded). */
export function medianPaise(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * Percentage change from `previous` to `current`. Returns null when there is no baseline to
 * compare against (previous is 0) — callers must render that as "new", never as Infinity or 0%.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function roundTo(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Share of `part` in `whole` as a percentage, or null when whole is 0. */
export function share(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return (part / whole) * 100;
}

const inrFormatter = (minFractionDigits: number, maxFractionDigits: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  });

const formatters = {
  none: inrFormatter(0, 0),
  auto: inrFormatter(0, 2),
  always: inrFormatter(2, 2),
};

export interface FormatMoneyOptions {
  /** "auto" shows decimals only when there are paise, "always" forces 2, "never" rounds. */
  decimals?: 'auto' | 'always' | 'never';
  /** Prefix + for positive values (negatives always show −). */
  signed?: boolean;
}

export function formatINR(paise: number, opts: FormatMoneyOptions = {}): string {
  const { decimals = 'auto', signed = false } = opts;
  const rupees = paiseToRupees(paise);
  // "auto": whole rupees show no decimals, anything with paise shows both digits (never "₹12.5")
  const key = decimals === 'never' ? 'none' : decimals === 'auto' ? (Math.abs(paise) % PAISE_PER_RUPEE === 0 ? 'none' : 'always') : decimals;
  const body = formatters[key].format(Math.abs(rupees)).replace(/\u00A0/g, '');
  if (paise < 0) return `−${body}`;
  if (signed && paise > 0) return `+${body}`;
  return body;
}

/** ₹1.2K, ₹3.4L (lakh), ₹1.5Cr (crore). Used on chart axes where space is tight. */
export function formatCompactINR(paise: number): string {
  const rupees = Math.abs(paiseToRupees(paise));
  const sign = paise < 0 ? '−' : '';
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  if (rupees >= 1_00_00_000) return `${sign}₹${trim(rupees / 1_00_00_000)}Cr`;
  if (rupees >= 1_00_000) return `${sign}₹${trim(rupees / 1_00_000)}L`;
  if (rupees >= 1_000) return `${sign}₹${trim(rupees / 1_000)}K`;
  return `${sign}₹${Math.round(rupees)}`;
}

export interface MoneyParts {
  sign: '' | '−';
  symbol: '₹';
  whole: string;
  fraction: string;
}

/** Splits an amount so the UI can render the paise de-emphasised, e.g. ₹17,339 . 03 */
export function splitMoney(paise: number): MoneyParts {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = String(abs % PAISE_PER_RUPEE).padStart(2, '0');
  const whole = new Intl.NumberFormat('en-IN').format(rupees);
  return { sign: paise < 0 ? '−' : '', symbol: '₹', whole, fraction };
}

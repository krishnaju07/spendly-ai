import { DateTime } from 'luxon';
import { formatCompactINR, formatINR } from '@spendly/shared';

export { formatCompactINR, formatINR };

export const inr = (paise: number, signed = false) => formatINR(paise, { decimals: 'auto', signed });
/** Whole rupees from ₹1,000 up — for prose and chart labels where paise are noise. */
export const inrRound = (paise: number) => formatINR(paise, { decimals: Math.abs(paise) >= 100_000 ? 'never' : 'auto' });

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`;
}

const FORMATS: Record<string, string> = { 'DD/MM/YYYY': 'dd/LL/yyyy', 'MM/DD/YYYY': 'LL/dd/yyyy', 'YYYY-MM-DD': 'yyyy-LL-dd' };

export function formatDate(iso: string, tz: string, style: 'short' | 'long' | 'pref' = 'short', pref = 'DD/MM/YYYY'): string {
  const dt = DateTime.fromISO(iso, { zone: tz });
  if (!dt.isValid) return iso;
  if (style === 'pref') return dt.toFormat(FORMATS[pref] ?? 'dd/LL/yyyy');
  return style === 'long' ? dt.toFormat('d LLL yyyy') : dt.toFormat('d LLL');
}

export const formatTime = (iso: string, tz: string) => DateTime.fromISO(iso, { zone: tz }).toFormat('h:mm a');

/** "Today", "Yesterday", "27 July" — the group headings in transaction lists. */
export function dayHeading(iso: string, tz: string, now = DateTime.now()): string {
  const d = DateTime.fromISO(iso, { zone: tz }).startOf('day');
  const today = now.setZone(tz).startOf('day');
  const diff = Math.round(today.diff(d, 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.year === today.year ? d.toFormat('d LLLL') : d.toFormat('d LLLL yyyy');
}

/** A day heading as two parts: "Today" / "Yesterday" / "Wednesday", and the date beside it. */
export function dayTitle(iso: string, tz: string, now = DateTime.now()): { title: string; date: string } {
  const d = DateTime.fromISO(iso, { zone: tz }).startOf('day');
  const today = now.setZone(tz).startOf('day');
  const diff = Math.round(today.diff(d, 'days').days);
  const date = d.year === today.year ? d.toFormat('d LLL') : d.toFormat('d LLL yyyy');
  if (diff === 0) return { title: 'Today', date };
  if (diff === 1) return { title: 'Yesterday', date };
  return { title: d.toFormat('cccc'), date };
}

export const dayKey = (iso: string, tz: string) => DateTime.fromISO(iso, { zone: tz }).toISODate() ?? iso;

export function relativeDays(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** "2026-03" → the first and last local day of that month, as YYYY-MM-DD (for deep links). */
export function monthSpan(key: string, tz: string): { from: string; to: string } {
  const start = DateTime.fromFormat(key, 'yyyy-LL', { zone: tz });
  return { from: start.toISODate() ?? key, to: start.endOf('month').toISODate() ?? key };
}

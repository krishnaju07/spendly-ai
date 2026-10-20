import { localDateKey } from './dates';
import { merchantSimilarity } from './text';

/**
 * Duplicate handling has two layers:
 *  1. Fingerprints for *exact* detection. Identical rows are matched as a multiset — if the
 *     database already holds N transactions with a fingerprint and the file has M rows with it,
 *     only the first min(N, M) rows are duplicates. Two genuine ₹50 chai purchases on one day are
 *     therefore never collapsed, but re-importing the same file adds nothing.
 *  2. Fuzzy scoring for *possible* duplicates (different spelling, a day apart) which always
 *     goes to the user to resolve.
 */

export interface FingerprintInput {
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  amountPaise: number;
  type: string;
  merchantKey: string;
  externalRef?: string | null;
}

export function normalizeReference(ref: string): string {
  return ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Rows that share a reference number and amount are the same payment regardless of wording. */
export function baseFingerprint(i: FingerprintInput): string {
  const ref = i.externalRef ? normalizeReference(i.externalRef) : '';
  if (ref.length >= 6) return `ref|${ref}|${i.amountPaise}`;
  return `${i.dateKey}|${i.amountPaise}|${i.type}|${i.merchantKey}`;
}

export interface DuplicateCandidate {
  date: Date;
  amountPaise: number;
  type: string;
  merchantKey: string;
  externalRef?: string | null;
  hasTime?: boolean;
}

export type DuplicateLevel = 'exact' | 'possible' | 'none';

export interface DuplicateScore {
  score: number;
  level: DuplicateLevel;
  reasons: string[];
}

const TEN_MINUTES = 10 * 60 * 1000;

export function scoreDuplicate(a: DuplicateCandidate, b: DuplicateCandidate, tz: string): DuplicateScore {
  const none: DuplicateScore = { score: 0, level: 'none', reasons: [] };
  if (a.amountPaise !== b.amountPaise || a.type !== b.type) return none;

  const refA = a.externalRef ? normalizeReference(a.externalRef) : '';
  const refB = b.externalRef ? normalizeReference(b.externalRef) : '';
  if (refA.length >= 6 && refA === refB) {
    return { score: 1, level: 'exact', reasons: ['Same reference number and amount'] };
  }

  const dayDiff = Math.abs(
    (new Date(`${localDateKey(a.date, tz)}T00:00:00Z`).getTime() -
      new Date(`${localDateKey(b.date, tz)}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (dayDiff > 1) return none;

  const sim = a.merchantKey === b.merchantKey ? 1 : merchantSimilarity(a.merchantKey, b.merchantKey);
  if (sim < 0.8) return none;

  const reasons = [`Same amount${dayDiff === 0 ? ' on the same day' : ' one day apart'}`];
  reasons.push(sim === 1 ? 'Same merchant' : `Similar merchant (${Math.round(sim * 100)}% match)`);
  const sameInstant =
    a.hasTime && b.hasTime && Math.abs(a.date.getTime() - b.date.getTime()) <= TEN_MINUTES;
  if (sameInstant) reasons.push('Within 10 minutes of each other');

  const score = Math.min(0.95, 0.55 + 0.25 * sim + (dayDiff === 0 ? 0.15 : 0) + (sameInstant ? 0.05 : 0));
  return { score, level: score >= 0.6 ? 'possible' : 'none', reasons };
}

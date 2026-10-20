import { DEFAULT_ALERT_THRESHOLDS } from './constants';

/** Budget arithmetic. Everything here is deterministic; projections are explicitly estimates. */

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetProgress {
  spentPaise: number;
  amountPaise: number;
  remainingPaise: number;
  /** Not capped: 130 means 30% over budget. */
  percentUsed: number;
  level: BudgetLevel;
  /** Highest alert threshold already crossed, if any. */
  crossedThreshold: number | null;
}

export function budgetProgress(
  spentPaise: number,
  amountPaise: number,
  thresholds: readonly number[] = DEFAULT_ALERT_THRESHOLDS,
): BudgetProgress {
  const percentUsed = amountPaise > 0 ? (spentPaise / amountPaise) * 100 : spentPaise > 0 ? Infinity : 0;
  const sorted = [...thresholds].sort((a, b) => a - b);
  const crossed = sorted.filter((t) => percentUsed >= t);
  const crossedThreshold = crossed.length > 0 ? (crossed[crossed.length - 1] as number) : null;
  const level: BudgetLevel = percentUsed >= 100 ? 'exceeded' : crossedThreshold !== null ? 'warning' : 'ok';
  return {
    spentPaise,
    amountPaise,
    remainingPaise: amountPaise - spentPaise,
    percentUsed,
    level,
    crossedThreshold,
  };
}

export interface Projection {
  projectedPaise: number;
  method: 'run_rate' | 'final';
  confidence: 'low' | 'medium' | 'high';
  note: string;
}

/**
 * Straight-line projection of the period total from spending so far. It cannot know about a rent
 * payment due on the 28th, so it is always labelled an estimate and its confidence falls when
 * little of the period has elapsed.
 */
export function projectSpend(spentPaise: number, elapsedDays: number, totalDays: number): Projection {
  if (elapsedDays >= totalDays) {
    return { projectedPaise: spentPaise, method: 'final', confidence: 'high', note: 'The period has ended — this is the final total.' };
  }
  const elapsed = Math.max(1, elapsedDays);
  const projected = Math.max(spentPaise, Math.round((spentPaise / elapsed) * totalDays));
  const fraction = elapsed / totalDays;
  const confidence = elapsed < 5 || fraction < 0.2 ? 'low' : fraction < 0.5 ? 'medium' : 'high';
  return {
    projectedPaise: projected,
    method: 'run_rate',
    confidence,
    note: `Estimate: spending so far over ${elapsed} of ${totalDays} days, extended to the full period. Large one-off bills later in the period are not predicted.`,
  };
}

export interface BudgetSuggestion {
  amountPaise: number;
  basisMonths: number;
  confidence: 'low' | 'medium' | 'high';
  basis: string;
}

function roundUp(valuePaise: number): number {
  const rupees = valuePaise / 100;
  const step = rupees >= 20_000 ? 1000 : rupees >= 5_000 ? 500 : 100;
  return Math.ceil(rupees / step) * step * 100;
}

/** Suggest a monthly budget from the totals of recent complete months (oldest → newest). */
export function suggestBudget(monthlyTotalsPaise: readonly number[]): BudgetSuggestion | null {
  const usable = monthlyTotalsPaise.filter((v) => v > 0).slice(-3);
  if (usable.length < 2) return null;
  const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
  const amountPaise = roundUp(avg * 1.05);
  return {
    amountPaise,
    basisMonths: usable.length,
    confidence: usable.length >= 3 ? 'medium' : 'low',
    basis: `Average of your last ${usable.length} months (₹${Math.round(avg / 100).toLocaleString('en-IN')}) plus a 5% buffer, rounded up.`,
  };
}

export interface ChangeDecomposition {
  deltaPaise: number;
  frequencyEffectPaise: number;
  orderValueEffectPaise: number;
  driver: 'frequency' | 'order_value' | 'mixed' | 'flat';
}

/**
 * Splits a change in spend into "you ordered more/less often" and "each order cost more/less":
 *   Δ = (n1 − n0)·avg0  +  n1·(avg1 − avg0)
 * The two effects add up to the exact change.
 */
export function decomposeChange(
  current: { count: number; totalPaise: number },
  baseline: { count: number; totalPaise: number },
): ChangeDecomposition {
  const delta = current.totalPaise - baseline.totalPaise;
  if (baseline.count === 0 || current.count === 0 || delta === 0) {
    return { deltaPaise: delta, frequencyEffectPaise: delta, orderValueEffectPaise: 0, driver: delta === 0 ? 'flat' : 'frequency' };
  }
  const avg0 = baseline.totalPaise / baseline.count;
  const frequency = Math.round((current.count - baseline.count) * avg0);
  const orderValue = delta - frequency;
  const abs = Math.abs(delta);
  const sameSign = (x: number) => Math.sign(x) === Math.sign(delta);
  const driver =
    sameSign(frequency) && Math.abs(frequency) >= 0.6 * abs
      ? 'frequency'
      : sameSign(orderValue) && Math.abs(orderValue) >= 0.6 * abs
        ? 'order_value'
        : 'mixed';
  return { deltaPaise: delta, frequencyEffectPaise: frequency, orderValueEffectPaise: orderValue, driver };
}

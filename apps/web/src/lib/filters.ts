import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { RANGE_PRESETS, type RangePreset } from '@spendly/shared';
import { useSession } from '@/hooks/use-auth';

/**
 * Date range and dimension filters live in the URL, so every chart click, shared link and browser
 * back button reproduces exactly the same slice of data.
 */
export interface Filters {
  category: string[];
  platform: string[];
  paymentMethod: string[];
  type: string[];
}

const LIST_KEYS = ['category', 'platform', 'paymentMethod', 'type'] as const;
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const isPreset = (v: string | null): v is RangePreset => Boolean(v && (RANGE_PRESETS as readonly string[]).includes(v) && v !== 'custom');

export interface RangeState {
  preset: RangePreset | null;
  from: string | null;
  to: string | null;
}

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const { prefs } = useSession();

  const range = useMemo<RangeState>(() => {
    const from = params.get('from');
    const to = params.get('to');
    if (from && to) return { preset: 'custom', from, to };
    const r = params.get('range');
    return { preset: isPreset(r) ? r : (prefs.defaultRange as RangePreset), from: null, to: null };
  }, [params, prefs.defaultRange]);

  const filters = useMemo<Filters>(
    () => ({
      category: list(params.get('category')),
      platform: list(params.get('platform')),
      paymentMethod: list(params.get('paymentMethod')),
      type: list(params.get('type')),
    }),
    [params],
  );

  /** Query parameters understood by every range-aware endpoint. */
  const rangeParams = useMemo(
    () => (range.from && range.to ? { from: range.from, to: range.to } : { preset: range.preset ?? undefined }),
    [range],
  );
  const apiParams = useMemo(
    () => ({
      ...rangeParams,
      category: filters.category,
      platform: filters.platform,
      paymentMethod: filters.paymentMethod,
      type: filters.type,
    }),
    [rangeParams, filters],
  );

  const setRange = useCallback(
    (next: { preset?: RangePreset; from?: string; to?: string }) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete('range');
          n.delete('from');
          n.delete('to');
          n.delete('page');
          if (next.from && next.to) {
            n.set('from', next.from);
            n.set('to', next.to);
          } else if (next.preset) n.set('range', next.preset);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setFilter = useCallback(
    (key: (typeof LIST_KEYS)[number], values: string[]) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete('page');
          if (values.length) n.set(key, values.join(','));
          else n.delete(key);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );

  const clearFilters = useCallback(
    () =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const k of LIST_KEYS) n.delete(k);
          n.delete('q');
          n.delete('page');
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { range, rangeParams, filters, apiParams, setRange, setFilter, clearFilters, activeCount: LIST_KEYS.reduce((n, k) => n + filters[k].length, 0), params, setParams };
}

/** Builds a /transactions link carrying the current range and the given extra filters. */
export function transactionsLink(
  range: { from?: string; to?: string; preset?: string | null },
  extra: Partial<Record<'category' | 'platform' | 'paymentMethod' | 'type' | 'q' | 'needsReview' | 'duplicates' | 'recurring', string>> = {},
): string {
  const p = new URLSearchParams();
  if (range.from && range.to) {
    p.set('from', range.from);
    p.set('to', range.to);
  } else if (range.preset) p.set('range', range.preset);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `/transactions?${p.toString()}`;
}

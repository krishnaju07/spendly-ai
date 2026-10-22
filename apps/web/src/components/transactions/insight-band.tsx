import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Crown, Leaf, Receipt, Store } from 'lucide-react';
import type { PeriodTotals, TransactionInsightsDto } from '@spendly/shared';
import { Money } from '@/components/common/money';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase';
const TILE = 'rounded-[24px] border bg-card p-4 shadow-card sm:rounded-[28px] sm:p-5';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Spend per day as a strip of bars, with the days nothing was spent shown as gaps, so the shape of a month is visible at once. */
function SpendBars({ daily }: { daily: TransactionInsightsDto['daily'] }) {
  const bars = useMemo(() => {
    if (daily.length === 0) return [];
    const byDay = new Map(daily.map((d) => [d.day, d.paise]));
    const out: Array<{ day: string; paise: number }> = [];
    for (
      let t = new Date(`${daily[0]?.day}T00:00:00Z`).getTime(),
        end = new Date(`${daily[daily.length - 1]?.day}T00:00:00Z`).getTime();
      t <= end;
      t += 86_400_000
    ) {
      const day = iso(new Date(t));
      out.push({ day, paise: byDay.get(day) ?? 0 });
    }
    return out.slice(-90);
  }, [daily]);
  if (bars.length < 2) return null;
  const max = Math.max(...bars.map((b) => b.paise), 1);
  const top = bars.reduce((a, b) => (b.paise > a.paise ? b : a));
  const W = 6;
  const short = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${bars.length * W} 56`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Spend per day. The highest was ${inr(top.paise)} on ${new Date(`${top.day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.`}
        className="h-14 w-full overflow-visible"
      >
        {bars.map((b, i) => {
          const h = b.paise === 0 ? 2 : Math.max(4, (b.paise / max) * 52);
          return (
            <rect
              key={b.day}
              x={i * W + 1}
              y={56 - h}
              width={W - 2}
              height={h}
              rx={1.5}
              fill={
                b === top ? 'var(--brand)' : b.paise === 0 ? 'var(--border)' : 'var(--series-7)'
              }
              opacity={b.paise === 0 ? 1 : b === top ? 1 : 0.75}
            >
              <title>{`${b.day}: ${inr(b.paise)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{short(bars[0]?.day ?? '')}</span>
        <span>{short(bars[bars.length - 1]?.day ?? '')}</span>
      </div>
    </div>
  );
}

/** Veg, non-veg and egg dishes as one split bar. */
function DietSplit({ diet }: { diet: NonNullable<TransactionInsightsDto['diet']> }) {
  const total = diet.veg + diet.nonveg + diet.egg;
  const part = (n: number) => Math.round((n / total) * 100);
  const segments = [
    { key: 'veg', n: diet.veg, color: 'var(--ok)', label: 'veg' },
    { key: 'nonveg', n: diet.nonveg, color: 'var(--bad)', label: 'non-veg' },
    { key: 'egg', n: diet.egg, color: 'var(--status-warning)', label: 'egg' },
  ].filter((s) => s.n > 0);
  return (
    <>
      <div
        className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={segments.map((s) => `${part(s.n)}% ${s.label}`).join(', ')}
      >
        {segments.map((s) => (
          <span
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.n / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="tnum font-semibold">{part(s.n)}%</span>{' '}
            <span className="text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

type Query = NonNullable<Parameters<typeof api.get>[1]>;

export const useInsights = (query: Query) =>
  useQuery({
    queryKey: ['transactions', 'insights', query],
    queryFn: () => api.get<TransactionInsightsDto>('/transactions/insights', query),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/** What this view adds up to, beyond one number: the month's shape, what you order most, and what is on your plate. */
export function InsightBand({ totals, query }: { totals: PeriodTotals | undefined; query: Query }) {
  const q = useInsights(query);
  const ins = q.data;

  if (!totals || (q.isPending && !ins)) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
        <Skeleton className="col-span-2 h-40 rounded-[28px]" />
        <Skeleton className="h-40 rounded-[28px]" />
        <Skeleton className="hidden h-40 rounded-[28px] lg:block" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 lg:grid-cols-4',
        q.isFetching && 'opacity-80 transition-opacity',
      )}
      aria-live="polite"
    >
      <section className={cn(TILE, 'col-span-2')} aria-label="Spent">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div>
            <p className={LABEL}>Spent</p>
            <Money paise={totals.netPaise} size="xl" className="mt-2" />
          </div>
          <div className="text-right text-[13px] text-muted-foreground">
            {ins && ins.count > 0 && (
              <p>
                <span className="tnum font-semibold text-foreground">{ins.count}</span> purchases ·
                avg{' '}
                <span className="tnum font-semibold text-foreground">{inr(ins.averagePaise)}</span>
              </p>
            )}
            {totals.refundsPaise > 0 && (
              <p className="text-ok">{inr(totals.refundsPaise)} refunded</p>
            )}
            {totals.incomePaise > 0 && <p className="text-ok">{inr(totals.incomePaise)} income</p>}
          </div>
        </div>
        {ins && <SpendBars daily={ins.daily} />}
      </section>

      {ins?.topPlace ? (
        <section className={TILE} aria-label="Favourite place">
          <p className={cn(LABEL, 'flex items-center gap-1.5')}>
            <Store className="size-3.5" aria-hidden /> Favourite place
          </p>
          <p className="mt-3 line-clamp-2 text-base leading-tight font-semibold tracking-tight sm:text-[19px]">
            {ins.topPlace.name}
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            <span className="tnum font-semibold text-foreground">{ins.topPlace.orders}</span>{' '}
            {ins.topPlace.orders === 1 ? 'order' : 'orders'} · {inr(ins.topPlace.paise)}
          </p>
          {ins.topDish && (
            <p className="mt-3 line-clamp-2 rounded-2xl bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
              Most ordered:{' '}
              <span className="font-semibold text-foreground">{ins.topDish.name}</span> ×
              {ins.topDish.times}
            </p>
          )}
        </section>
      ) : (
        ins?.biggest && (
          <section className={TILE} aria-label="Biggest purchase">
            <p className={cn(LABEL, 'flex items-center gap-1.5')}>
              <Crown className="size-3.5" aria-hidden /> Biggest purchase
            </p>
            <Money paise={ins.biggest.paise} size="lg" className="mt-3" />
            <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">
              {ins.biggest.title}
            </p>
          </section>
        )
      )}

      {ins?.diet ? (
        <section className={TILE} aria-label="Veg and non-veg">
          <p className={cn(LABEL, 'flex items-center gap-1.5')}>
            <Leaf className="size-3.5" aria-hidden /> On your plate
          </p>
          <DietSplit diet={ins.diet} />
          <p className="mt-3 text-xs text-muted-foreground">
            By dishes ordered, from your linked accounts.
          </p>
        </section>
      ) : (
        ins &&
        ins.count > 0 && (
          <section className={cn(TILE, 'hidden lg:block')} aria-label="Average purchase">
            <p className={cn(LABEL, 'flex items-center gap-1.5')}>
              <Receipt className="size-3.5" aria-hidden /> Average purchase
            </p>
            <Money paise={ins.averagePaise} size="lg" className="mt-3" />
            <p className="mt-2 text-[13px] text-muted-foreground">across {ins.count} purchases</p>
          </section>
        )
      )}
    </div>
  );
}

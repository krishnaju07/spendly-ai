import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { CategoryStatDto, CompareDto, MerchantStatDto, PatternsDto, PlatformStatDto, RangeDto, TrendPointDto } from '@spendly/shared';
import { CategoryIcon, assignSlots, seriesVar } from '@/components/common/category-icon';
import { Delta } from '@/components/common/chips';
import { CountUp } from '@/components/common/count-up';
import { FilterBar } from '@/components/common/filter-bar';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { Segmented } from '@/components/common/segmented';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/states';
import { ChartCard, Legend } from '@/components/charts/chart-frame';
import { ColumnChart, PairBars, StackedColumns, type Column, type PairRow, type StackPoint } from '@/components/charts/columns';
import { HourStrip, type HourCell } from '@/components/charts/hour-strip';
import { RingChart, type RingSlice } from '@/components/charts/ring-chart';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCatalog } from '@/hooks/use-catalog';
import { useIsDesktop } from '@/hooks/use-media-query';
import { transactionsLink, useFilters } from '@/lib/filters';
import { api } from '@/lib/api';
import { inr, inrRound, plural } from '@/lib/format';

type Grain = 'day' | 'week' | 'month';
type Split = 'none' | 'category' | 'platform';
interface TrendResp {
  range: RangeDto;
  granularity: Grain;
  points?: TrendPointDto[];
  grouped?: { keys: Array<{ key: string; name: string }>; points: StackPoint[] };
}

function Kpi({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[24px] bg-tile p-4 sm:p-5">
      <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">{label}</p>
      <div>{children}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const defaultGrain = (days: number): Grain => (days > 400 ? 'month' : days > 62 ? 'week' : 'day');

export default function Analytics() {
  const cat = useCatalog();
  // about how many day labels fit under the plot: eight crowd a phone-width axis into one smear
  const axisLabels = useIsDesktop() ? 8 : 4;
  const navigate = useNavigate();
  const { rangeParams, apiParams, params, setParams } = useFilters();
  const split = (['category', 'platform'].includes(params.get('by') ?? '') ? params.get('by') : 'none') as Split;
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const compare = useQuery({ queryKey: ['analytics', 'compare', apiParams], queryFn: () => api.get<CompareDto>('/analytics/compare', apiParams), placeholderData: keepPreviousData });
  const days = compare.data?.current.days ?? 30;
  const requested = params.get('grain');
  const grain: Grain = requested === 'day' || requested === 'week' || requested === 'month' ? requested : defaultGrain(days);
  const trend = useQuery({
    queryKey: ['analytics', 'trends', apiParams, grain, split],
    queryFn: () => api.get<TrendResp>('/analytics/trends', { ...apiParams, granularity: grain, groupBy: split }),
    placeholderData: keepPreviousData,
    enabled: compare.isSuccess || compare.isError,
  });
  const patterns = useQuery({ queryKey: ['analytics', 'patterns', apiParams], queryFn: () => api.get<PatternsDto>('/analytics/patterns', apiParams), placeholderData: keepPreviousData });
  const merchants = useQuery({ queryKey: ['analytics', 'merchants', apiParams], queryFn: () => api.get<MerchantStatDto[]>('/analytics/merchants', { ...apiParams, limit: 10 }), placeholderData: keepPreviousData });

  const c = compare.data;
  const span = c ? { from: c.current.fromDate, to: c.current.toDate } : rangeParams;
  const link = (extra: Parameters<typeof transactionsLink>[1] = {}) => transactionsLink(span, extra);

  // categories: the five biggest keep their own colour, the rest fold into "Other"
  const spending = useMemo(() => (c?.categories ?? []).filter((x) => x.netPaise > 0), [c]);
  const slices = useMemo<RingSlice[]>(() => {
    const top = spending.slice(0, 5);
    const colors = assignSlots(top.map((x) => ({ key: x.slug ?? 'none', slot: cat.category(x.slug)?.slot ?? null })));
    const out: RingSlice[] = top.map((x) => ({ key: x.slug ?? 'none', label: x.name, value: x.netPaise, color: colors.get(x.slug ?? 'none') ?? 'var(--series-other)', display: inrRound(x.netPaise), href: link({ category: x.slug ?? 'none' }) }));
    const rest = spending.slice(5);
    if (rest.length) out.push({ key: 'other', label: `Other (${rest.length})`, value: rest.reduce((a, x) => a + x.netPaise, 0), color: 'var(--series-other)', display: inrRound(rest.reduce((a, x) => a + x.netPaise, 0)), href: link({ category: rest.map((x) => x.slug ?? 'none').join(',') }) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spending, cat, span.from, span.to]);

  const stack = useMemo(() => {
    const g = trend.data?.grouped;
    if (!g) return null;
    const colors = assignSlots(g.keys.filter((k) => k.key !== 'other').map((k) => ({ key: k.key, slot: split === 'category' ? (cat.category(k.key)?.slot ?? null) : null })));
    colors.set('other', 'var(--series-other)');
    return { ...g, colors };
  }, [trend.data, split, cat]);

  const columns = useMemo<Column[]>(() => (trend.data?.points ?? []).map((p) => ({ key: p.key, label: p.label, value: p.netPaise, extra: [{ label: 'Purchases', value: String(p.count) }] })), [trend.data]);
  const pairs = useMemo<PairRow[]>(() => (c?.categories ?? []).filter((x) => x.netPaise > 0 || x.previousNetPaise > 0).slice(0, 8).map((x) => ({ key: x.slug ?? 'none', label: x.name, current: Math.max(0, x.netPaise), previous: Math.max(0, x.previousNetPaise) })), [c]);
  const hours = useMemo<HourCell[]>(() => {
    const byHour = new Map((patterns.data?.hourly ?? []).map((h) => [h.hour, h]));
    return Array.from({ length: 24 }, (_, hour) => ({ hour, netPaise: byHour.get(hour)?.netPaise ?? 0, count: byHour.get(hour)?.count ?? 0 }));
  }, [patterns.data]);
  const weekdays = useMemo<Column[]>(() => (patterns.data?.weekday ?? []).map((w) => ({ key: String(w.weekday), label: w.label, value: w.netPaise, extra: [{ label: 'Purchases', value: String(w.count) }] })), [patterns.data]);

  if (compare.isError) return <ErrorState error={compare.error} onRetry={() => compare.refetch()} />;
  const cur = c?.totals.current;
  const prev = c?.totals.previous;
  const change = (a?: number, b?: number) => (a === undefined || b === undefined || b === 0 ? null : ((a - b) / b) * 100);
  const noData = c && cur && cur.expenseCount === 0 && cur.refundCount === 0;
  const perDay = c && cur ? Math.round(cur.netPaise / Math.max(1, c.current.elapsedDays)) : 0;
  const avgTxn = cur && cur.expenseCount > 0 ? Math.round(cur.grossPaise / cur.expenseCount) : 0;
  const platforms = (c?.platforms ?? []).filter((p: PlatformStatDto) => p.netPaise > 0).slice(0, 10);
  const maxPlatform = Math.max(...platforms.map((p) => p.netPaise), 1);
  const catRows: CategoryStatDto[] = spending.slice(0, 10);

  return (
    <div className="stagger space-y-5">
      <PageHeader title="Spending Analytics" subtitle="Every figure here is calculated from your transactions. Refunds reduce spending; transfers and pending payments are left out." />
      <FilterBar />

      {noData ? (
        <EmptyState className="rounded-[28px] border bg-card" title="Nothing in this view" description="No spending matches this period and these filters. Widen the date range, clear a filter, or import a statement." action={{ label: 'Import a statement', to: '/import' }} />
      ) : (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Net spending" sub={c ? <span>vs {inrRound(prev?.netPaise ?? 0)} {c.baseline.baselineLabel.toLowerCase()}</span> : null}>
              {cur ? <div className="flex flex-wrap items-center gap-2"><Money paise={cur.netPaise} size="lg" animate /><Delta value={change(cur.netPaise, prev?.netPaise)} /></div> : <Skeleton className="h-7 w-28" />}
            </Kpi>
            <Kpi label="Purchases" sub={prev ? `${plural(prev.expenseCount, 'purchase')} before` : null}>
              {cur ? <div className="flex flex-wrap items-center gap-2"><CountUp className="type-lg text-[22px] leading-none tnum" value={cur.expenseCount} /><Delta value={change(cur.expenseCount, prev?.expenseCount)} /></div> : <Skeleton className="h-7 w-16" />}
            </Kpi>
            <Kpi label="Average per day" sub={c ? `Over ${plural(Math.max(1, c.current.elapsedDays), 'day')}` : null}>
              {c ? <Money paise={perDay} size="lg" animate /> : <Skeleton className="h-7 w-24" />}
            </Kpi>
            <Kpi label="Average purchase" sub={cur && cur.refundsPaise > 0 ? `${inr(cur.refundsPaise)} refunded` : 'Before refunds'}>
              {cur ? <Money paise={avgTxn} size="lg" animate /> : <Skeleton className="h-7 w-24" />}
            </Kpi>
          </section>

          <ChartCard
            title="Spending over time"
            description={split === 'none' ? 'Net spending per period. Select a bar to see its transactions.' : `Split by ${split}; the largest six are shown, the rest are grouped as Other.`}
            isPending={trend.isPending}
            isFetching={trend.isFetching}
            error={trend.error}
            onRetry={() => trend.refetch()}
            height={280}
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <Segmented size="sm" label="Group by" value={split} onChange={(v) => setParam('by', v === 'none' ? null : v)} options={[{ value: 'none', label: 'Total' }, { value: 'category', label: 'Category' }, { value: 'platform', label: 'Platform' }]} />
                <Segmented size="sm" label="Interval" value={grain} onChange={(v) => setParam('grain', v)} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
              </div>
            }
            table={
              stack
                ? { columns: ['Period', ...stack.keys.map((k) => k.name)], rows: stack.points.map((p) => [p.label, ...stack.keys.map((k) => inrRound(p.values[k.key] ?? 0))]) }
                : { columns: ['Period', 'Net spend', 'Purchases'], rows: (trend.data?.points ?? []).map((p) => [p.label, inrRound(p.netPaise), p.count]) }
            }
          >
            {stack ? <StackedColumns points={stack.points} series={stack.keys} colors={stack.colors} /> : <ColumnChart data={columns} tickEvery={grain === 'day' && columns.length > 20 ? Math.ceil(columns.length / axisLabels) : undefined} />}
          </ChartCard>
          {stack && <Legend items={stack.keys.map((k) => ({ key: k.key, label: k.name, color: stack.colors.get(k.key) ?? 'var(--series-other)' }))} className="-mt-2 px-2" />}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card aria-label="Spending by category">
              <h2 className="text-[15px] font-semibold tracking-tight">Where it went</h2>
              {compare.isPending ? <Skeleton className="mx-auto aspect-square w-full max-w-[17.5rem] rounded-full" /> : (
                <div className="grid items-center gap-6 md:grid-cols-[17.5rem_1fr] xl:grid-cols-1 2xl:grid-cols-[17.5rem_1fr]">
                  <RingChart slices={slices} legend={false} centerLabel="Net spend" centerValue={<Money paise={cur?.netPaise ?? 0} size="lg" />} onSelect={(s) => s.href && navigate(s.href)} className="mx-auto w-full" />
                  <ul className="space-y-1">
                    {catRows.map((x) => {
                      const meta = cat.category(x.slug);
                      return (
                        <li key={x.slug ?? 'none'}>
                          <Link to={link({ category: x.slug ?? 'none' })} className="flex items-center gap-3 rounded-2xl px-2 py-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                            <CategoryIcon icon={meta?.icon} color={seriesVar(meta?.slot)} size={34} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{x.name}</span>
                              <span className="block text-xs text-muted-foreground tnum">{x.sharePct !== null ? `${Math.round(x.sharePct)}%` : ''} · {plural(x.count, 'purchase')}</span>
                            </span>
                            <span className="flex flex-col items-end gap-1">
                              <Money paise={x.netPaise} size="md" />
                              {x.changePct !== null && Math.abs(x.changePct) >= 1 ? <Delta value={x.changePct} /> : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Card>

            <ChartCard
              title="Against the previous period"
              description={c ? `${c.current.label} compared with ${c.baseline.label}.` : undefined}
              isPending={compare.isPending}
              height={Math.max(220, pairs.length * 44 + 24)}
              empty={pairs.length === 0 ? <p className="text-sm text-muted-foreground">No categories to compare.</p> : undefined}
              table={{ columns: ['Category', 'This period', 'Previous'], rows: pairs.map((p) => [p.label, inrRound(p.current), inrRound(p.previous)]) }}
            >
              <PairBars data={pairs} currentLabel={c?.current.label ?? 'This period'} previousLabel={c?.baseline.label ?? 'Previous'} onSelect={(r) => navigate(link({ category: r.key }))} />
            </ChartCard>
          </div>

          <Card aria-label="Platforms">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight">Platforms</h2>
              <Link to="/platforms" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">All platforms <ArrowRight className="size-3.5" aria-hidden /></Link>
            </div>
            {compare.isPending ? <Skeleton className="h-48 rounded-2xl" /> : platforms.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No platform spending in this view.</p> : (
              <ol className="space-y-1">
                {platforms.map((p, i) => {
                  const view = cat.platform(p.slug);
                  return (
                    <li key={p.slug ?? i}>
                      <Link to={p.slug ? `/platforms/${p.slug}` : link({ platform: 'none' })} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="w-4 text-center text-xs text-muted-foreground tnum">{i + 1}</span>
                        <PlatformLogo platform={view} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-medium">{p.name}</span>
                            <Money paise={p.netPaise} size="md" />
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(2, (p.netPaise / maxPlatform) * 100)}%` }} /></span>
                          <span className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="tnum">{plural(p.count, 'transaction')} · avg {inrRound(p.avgPaise)}</span>
                            {p.changePct !== null && Math.abs(p.changePct) >= 1 ? <Delta value={p.changePct} /> : <span>{p.previousNetPaise === 0 ? 'New' : 'Steady'}</span>}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="By day of week"
              description="Net spending on each weekday across this period."
              isPending={patterns.isPending}
              height={220}
              table={{ columns: ['Weekday', 'Net spend', 'Purchases'], rows: (patterns.data?.weekday ?? []).map((w) => [w.label, inrRound(w.netPaise), w.count]) }}
            >
              <ColumnChart data={weekdays} tickEvery={1} />
            </ChartCard>
            <ChartCard
              title="By time of day"
              description={patterns.data?.timestampedShare != null ? `Based on the ${Math.round(patterns.data.timestampedShare * 100)}% of transactions that carry a time. Bank statements often do not.` : 'Only transactions with a time of day are included. Bank statements often do not carry one.'}
              isPending={patterns.isPending}
              height={170}
              empty={patterns.data && !patterns.data.timestampedShare ? <p className="max-w-xs text-center text-sm text-muted-foreground">None of these transactions have a time of day, so this chart cannot be drawn. Receipts and some UPI exports include times.</p> : undefined}
              table={{ columns: ['Hour', 'Net spend', 'Purchases'], rows: hours.filter((h) => h.count > 0).map((h) => [`${h.hour}:00`, inrRound(h.netPaise), h.count]) }}
            >
              <HourStrip cells={hours} />
            </ChartCard>
          </div>

          <Card aria-label="Top merchants">
            <h2 className="text-[15px] font-semibold tracking-tight">Top merchants</h2>
            {merchants.isPending ? <Skeleton className="h-40 rounded-2xl" /> : (merchants.data ?? []).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No merchants in this view.</p> : (
              <ol className="divide-y">
                {(merchants.data ?? []).map((m, i) => (
                  <li key={m.merchantKey}>
                    <Link to={link({ q: m.merchantName })} className="flex items-center gap-3 py-3 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="w-5 text-center text-xs text-muted-foreground tnum">{i + 1}</span>
                      <PlatformLogo platform={cat.platform(m.platform)} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.merchantName}</span>
                        <span className="block text-xs text-muted-foreground tnum">{plural(m.count, 'transaction')}</span>
                      </span>
                      <Money paise={m.netPaise} size="md" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

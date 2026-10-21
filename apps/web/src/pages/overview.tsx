import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowRight, Copy, Gauge, CircleHelp, Plus, Receipt, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { CategoryStatDto, DashboardSummaryDto, Paged, TransactionDto, TrendsDto } from '@spendly/shared';
import { assignSlots } from '@/components/common/category-icon';
import { Delta, Dot } from '@/components/common/chips';
import { CountUp } from '@/components/common/count-up';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, SectionTitle } from '@/components/common/states';
import { ChartCard, Legend } from '@/components/charts/chart-frame';
import { ColumnChart, type Column } from '@/components/charts/columns';
import { MomLines, type MomPoint } from '@/components/charts/lines';
import { RingChart, type RingSlice } from '@/components/charts/ring-chart';
import { useTransactionPanel } from '@/components/transactions/transaction-panel';
import { TxnRow } from '@/components/transactions/txn-row';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { useFilters, transactionsLink } from '@/lib/filters';
import { dayHeading, dayKey, inr, inrRound, monthSpan, plural } from '@/lib/format';
import { FilterBar } from '@/components/common/filter-bar';
import { rangeLabel } from '@/components/common/date-range';
import { cn } from '@/lib/utils';

type MomResponse = { currentLabel: string; previousLabel: string; points: MomPoint[] };
type BudgetVsSpend = { budgetPaise: number | null; points: Array<{ key: string; label: string; spentPaise: number }>; currentMonth: string };

function Tile({ icon: Icon, label, children, sub, to }: { icon: typeof Gauge; label: string; children: React.ReactNode; sub?: React.ReactNode; to?: string }) {
  const body = (
    <div className="flex h-full min-w-[10.5rem] flex-col gap-4 rounded-[28px] bg-tile p-4 transition-colors sm:p-5">
      <span className="grid size-10 place-items-center rounded-full bg-background/50 dark:bg-white/[0.06]">
        <Icon className="size-[18px]" strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">{label}</p>
        <div className="mt-1.5">{children}</div>
        {sub && <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="lift block rounded-[28px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function Overview() {
  const { prefs, user } = useSession();
  const tz = prefs.timezone;
  const navigate = useNavigate();
  const { openNew, openView } = useTransactionPanel();
  const cat = useCatalog();
  const { rangeParams, filters, apiParams } = useFilters();

  const summary = useQuery({ queryKey: ['dashboard', 'summary', apiParams], queryFn: () => api.get<DashboardSummaryDto>('/dashboard/summary', apiParams), placeholderData: keepPreviousData });
  const cats = useQuery({ queryKey: ['analytics', 'categories', apiParams], queryFn: () => api.get<{ items: CategoryStatDto[] }>('/analytics/categories', apiParams), placeholderData: keepPreviousData });
  const filterOnly = { category: filters.category, platform: filters.platform, paymentMethod: filters.paymentMethod, type: filters.type };
  const monthly = useQuery({ queryKey: ['dashboard', 'trends', 'month', filterOnly], queryFn: () => api.get<TrendsDto>('/dashboard/trends', { granularity: 'month', months: 12, ...filterOnly }), placeholderData: keepPreviousData });
  const days = summary.data?.range.days ?? 30;
  const granularity = days > 62 ? 'week' : 'day';
  const daily = useQuery({ queryKey: ['dashboard', 'trends', granularity, apiParams], queryFn: () => api.get<TrendsDto>('/dashboard/trends', { granularity, ...apiParams }), placeholderData: keepPreviousData });
  const mom = useQuery({ queryKey: ['dashboard', 'mom'], queryFn: () => api.get<MomResponse>('/dashboard/month-over-month') });
  const bvs = useQuery({ queryKey: ['dashboard', 'budget-vs-spend'], queryFn: () => api.get<BudgetVsSpend>('/dashboard/budget-vs-spend') });
  const recent = useQuery({ queryKey: ['transactions', 'recent', filterOnly], queryFn: () => api.get<Paged<TransactionDto>>('/transactions', { pageSize: 10, ...filterOnly }), placeholderData: keepPreviousData });

  const s = summary.data;
  const link = (extra: Parameters<typeof transactionsLink>[1] = {}) => transactionsLink(s ? { from: s.range.fromDate, to: s.range.toDate } : rangeParams, extra);

  // ring: top five categories keep their own colours; the rest fold into "Other"
  const slices = useMemo<RingSlice[]>(() => {
    const items = (cats.data?.items ?? []).filter((c) => c.netPaise > 0);
    const top = items.slice(0, 5);
    const colors = assignSlots(top.map((c) => ({ key: c.slug ?? 'none', slot: cat.category(c.slug)?.slot ?? null })));
    const out: RingSlice[] = top.map((c) => ({
      key: c.slug ?? 'none',
      label: c.name,
      value: c.netPaise,
      color: colors.get(c.slug ?? 'none') ?? 'var(--series-other)',
      display: inrRound(c.netPaise),
      href: link({ category: c.slug ?? 'none' }),
      trailing: c.changePct !== null && Math.abs(c.changePct) >= 1 ? <Delta value={c.changePct} /> : undefined,
    }));
    const rest = items.slice(5);
    if (rest.length) {
      const total = rest.reduce((a, c) => a + c.netPaise, 0);
      out.push({ key: 'other', label: `Other (${rest.length})`, value: total, color: 'var(--series-other)', display: inrRound(total), href: link({ category: rest.map((c) => c.slug ?? 'none').join(',') }) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats.data, cat, s?.range.fromDate, s?.range.toDate]);

  const monthColumns = useMemo<Column[]>(
    () => (monthly.data?.points ?? []).map((p, i, all) => ({ key: p.key, label: p.label, value: p.netPaise, dim: i !== all.length - 1, extra: [{ label: 'Purchases', value: String(p.count) }] })),
    [monthly.data],
  );
  const dailyColumns = useMemo<Column[]>(() => (daily.data?.points ?? []).map((p) => ({ key: p.key, label: p.label, value: p.netPaise, extra: [{ label: 'Purchases', value: String(p.count) }] })), [daily.data]);
  const dailyAvg = dailyColumns.length ? Math.round(dailyColumns.reduce((a, c) => a + c.value, 0) / dailyColumns.length) : 0;
  const budgetColumns = useMemo<Column[]>(
    () => (bvs.data?.points ?? []).map((p) => ({ key: p.key, label: p.label, value: p.spentPaise, color: bvs.data?.budgetPaise && p.spentPaise > bvs.data.budgetPaise ? 'var(--status-serious)' : undefined })),
    [bvs.data],
  );

  const grouped = useMemo(() => {
    const out: Array<{ day: string; heading: string; items: TransactionDto[] }> = [];
    for (const t of recent.data?.items ?? []) {
      const k = dayKey(t.date, tz);
      const last = out[out.length - 1];
      if (last?.day === k) last.items.push(t);
      else out.push({ day: k, heading: dayHeading(t.date, tz), items: [t] });
    }
    return out;
  }, [recent.data, tz]);

  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  if (s && !s.hasData) {
    return (
      <EmptyState
        className="mx-auto max-w-xl rounded-[32px] border bg-card"
        title={`Welcome${user.isDemo ? '' : `, ${user.name.split(' ')[0]}`}`}
        description={
          <>
            Nothing to show yet. Add a transaction to see what you spend on food and entertainment.
            {prefs.tracking.platforms.length > 0 && (
              <span className="mt-4 flex flex-wrap justify-center gap-2">
                {prefs.tracking.platforms.map((slug) => (
                  <span key={slug} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pr-3 pl-1 text-xs font-medium text-foreground">
                    <PlatformLogo platform={cat.platform(slug)} size={20} />
                    {cat.platformName(slug)}
                  </span>
                ))}
              </span>
            )}
          </>
        }
        action={{ label: 'Add a transaction', onClick: () => openNew() }}
        secondary={prefs.tracking.platforms.length ? undefined : { label: 'Choose apps to track', to: '/settings?tab=tracking' }}
      />
    );
  }

  const top = s?.topPlatforms.filter((p) => p.slug).slice(0, 6) ?? [];
  const maxPlatform = Math.max(...top.map((p) => p.netPaise), 1);
  const periodWord = s ? rangeLabel({ preset: s.range.preset, from: s.range.preset === 'custom' ? s.range.fromDate : null, to: s.range.preset === 'custom' ? s.range.toDate : null }) : '';

  return (
    <div className="stagger grid grid-cols-12 gap-4">
      <h1 className="sr-only">Overview</h1>
      {/* ── hero ───────────────────────────────────────────────────────────────────────────── */}
      <section aria-label="Spending summary" className="grain relative col-span-12 overflow-hidden rounded-[32px] border bg-card p-5 shadow-card sm:p-7 xl:col-span-7">
        <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(124_92_255/0.22),transparent)] dark:opacity-100" aria-hidden />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Spent · {periodWord}</p>
            {s ? (
              <div className="mt-3">
                <Money paise={s.current.netPaise} size="hero" />
              </div>
            ) : (
              <Skeleton className="mt-3 h-[72px] w-72 max-w-full rounded-2xl" />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {s && <Delta value={s.changePct.net} />}
              {s && <span className="text-[13px] text-muted-foreground">vs {inrRound(s.previous.netPaise)} {s.baseline.baselineLabel.toLowerCase()}</span>}
            </div>
            {s && s.current.refundsPaise > 0 && <p className="mt-2 text-[13px] text-muted-foreground">Net of {inr(s.current.refundsPaise)} refunded — purchases were {inr(s.current.grossPaise)}.</p>}
            <div className="mt-6 flex flex-wrap gap-2 max-sm:[&>*]:grow max-sm:[&>*]:px-3">
              <Button onClick={() => openNew()}><Plus /> Add</Button>
              <Button variant="secondary" asChild><Link to="/coach"><Sparkles /> Ask coach</Link></Button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[14.5rem] shrink-0 sm:max-w-[17.5rem] lg:mx-0">
            {cats.isPending ? (
              <Skeleton className="aspect-square w-full rounded-full" />
            ) : (
              <RingChart
                slices={slices}
                legend={false}
                centerLabel="This period"
                centerValue={<span className="type-lg text-[24px] leading-none">{plural(s?.current.expenseCount ?? 0, 'purchase')}</span>}
                onSelect={(sl) => sl.href && navigate(sl.href)}
              />
            )}
          </div>
        </div>
      </section>

      {/* ── metric tiles ───────────────────────────────────────────────────────────────────── */}
      <section aria-label="Key figures" className="col-span-12 xl:col-span-5">
        {/* `relative` matters: the Delta chips inside hold an absolutely-positioned sr-only span, and without a positioned
            ancestor the row's overflow cannot clip it, so it stretched the whole page sideways on phones */}
        <div className="scrollbar-none relative -mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 *:snap-start *:shrink-0 md:*:shrink">
          {prefs.incomeTracking && (
            <Tile icon={ArrowDownToLine} label="Income" to={link({ type: 'income' })} sub={s ? <Delta value={s.changePct.income} goodWhen="up" /> : null}>
              {s ? <Money paise={s.current.incomePaise} size="lg" animate /> : <Skeleton className="h-7 w-24" />}
            </Tile>
          )}
          <Tile icon={Gauge} label="Budget left" to="/budgets" sub={s?.budget ? <span>of {inrRound(s.budget.totalBudgetPaise)} this month</span> : <span>No monthly budget set</span>}>
            {s?.budget ? (
              <>
                <Money paise={Math.max(0, s.budget.remainingPaise)} size="lg" animate />
                <Progress value={s.budget.percentUsed} level={s.budget.percentUsed >= 100 ? 'bad' : s.budget.percentUsed >= 80 ? 'warn' : 'neutral'} label="Budget used" className="mt-2.5 h-1.5" />
              </>
            ) : (
              <span className="text-lg font-semibold">—</span>
            )}
          </Tile>
          <Tile icon={Sparkles} label="Potential savings" to="/coach" sub={s?.potentialSavings ? <span>per month · estimate, {s.potentialSavings.confidence} confidence</span> : <span>Needs 2+ months of history</span>}>
            {s?.potentialSavings ? <Money paise={s.potentialSavings.monthlyPaise} size="lg" animate /> : <span className="text-lg font-semibold">—</span>}
          </Tile>
          <Tile icon={Receipt} label="Transactions" to={link()} sub={s ? <span>avg {inrRound(s.current.expenseCount ? Math.round(s.current.grossPaise / s.current.expenseCount) : 0)} each</span> : null}>
            {s ? <CountUp className="type-lg text-[22px] leading-none" value={s.current.expenseCount} /> : <Skeleton className="h-7 w-16" />}
          </Tile>
        </div>
      </section>

      {/* ── alerts ─────────────────────────────────────────────────────────────────────────── */}
      {s && (s.needsReview > 0 || s.possibleDuplicates > 0) && (
        <div className="col-span-12 flex flex-wrap gap-2">
          {s.needsReview > 0 && (
            <Button asChild variant="outline" size="sm" className="h-auto gap-2 py-2 whitespace-normal">
              <Link to={link({ needsReview: 'true' })}><CircleHelp className="text-[var(--status-warning)]" /> {plural(s.needsReview, 'transaction')} need a quick review</Link>
            </Button>
          )}
          {s.possibleDuplicates > 0 && (
            <Button asChild variant="outline" size="sm" className="h-auto gap-2 py-2 whitespace-normal">
              <Link to={link({ duplicates: 'true' })}><Copy className="text-[var(--status-serious)]" /> {plural(s.possibleDuplicates, 'possible duplicate')} to resolve</Link>
            </Button>
          )}
        </div>
      )}

      <div className="col-span-12">
        <FilterBar />
      </div>

      {/* ── categories + platforms ─────────────────────────────────────────────────────────── */}
      <section className="col-span-12 flex flex-col rounded-[32px] border bg-card p-5 shadow-card sm:p-6 lg:col-span-6">
        <SectionTitle action={<Link to="/analytics" className="hit-area text-xs font-medium text-muted-foreground hover:text-foreground">Analytics <ArrowRight className="inline size-3" /></Link>}>Categories</SectionTitle>
        <div className="mt-4 flex flex-1 flex-col">
          {cats.isPending ? <Skeleton className="h-64 w-full rounded-2xl" /> : slices.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No spending in this period.</p> : (
            <ul className="grid flex-1 gap-2 sm:grid-cols-2 sm:auto-rows-fr">
              {slices.map((sl) => {
                const total = slices.reduce((a, x) => a + x.value, 0);
                const share = Math.round((sl.value / total) * 100);
                return (
                  <li key={sl.key}>
                    <Link to={sl.href ?? '#'} className="flex h-full flex-col justify-center gap-2.5 rounded-2xl bg-muted/70 px-3.5 py-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex items-center gap-2.5">
                        <Dot color={sl.color} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{sl.label}</span>
                        <span className="tnum text-sm font-semibold">{sl.display}</span>
                      </span>
                      <span className="flex items-center gap-2.5">
                        <span aria-hidden className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
                          <span className="block h-full rounded-full" style={{ width: `${Math.max(share, 3)}%`, backgroundColor: sl.color }} />
                        </span>
                        <span className="tnum w-8 text-right text-xs text-muted-foreground">{share}%</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="col-span-12 rounded-[32px] border bg-card p-5 shadow-card sm:p-6 lg:col-span-6">
        <SectionTitle action={<Link to="/platforms" className="hit-area text-xs font-medium text-muted-foreground hover:text-foreground">All platforms <ArrowRight className="inline size-3" /></Link>}>Platforms</SectionTitle>
        <ol className="mt-3 space-y-1">
          {summary.isPending && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
          {top.map((p, i) => (
            <li key={p.slug}>
              <Link to={link({ platform: p.slug ?? 'none' })} className="group flex items-center gap-3 rounded-2xl px-1.5 py-2 outline-none hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="tnum w-4 text-center text-xs text-muted-foreground">{i + 1}</span>
                <PlatformLogo platform={cat.platform(p.slug)} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="tnum text-sm font-semibold">{inrRound(p.netPaise)}</span>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                      <span className="block h-full rounded-full bg-series-1" style={{ width: `${Math.max(3, (p.netPaise / maxPlatform) * 100)}%` }} />
                    </span>
                    <span className="tnum w-[4.5rem] shrink-0 text-right text-xs text-muted-foreground">{plural(p.count, 'order')}</span>
                  </span>
                </span>
                <span className="hidden w-[4.25rem] shrink-0 justify-end sm:flex"><Delta value={p.changePct} /></span>
              </Link>
            </li>
          ))}
          {summary.isSuccess && top.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No platform spending in this period.</p>}
        </ol>
      </section>

      {/* ── charts ─────────────────────────────────────────────────────────────────────────── */}
      <ChartCard
        className="col-span-12 lg:col-span-7"
        title="Monthly trend"
        description="Net spending by month — the current month is highlighted. Select a month to see its transactions."
        isPending={monthly.isPending}
        isFetching={monthly.isFetching}
        error={monthly.error}
        onRetry={() => monthly.refetch()}
        table={{ columns: ['Month', 'Net spend'], rows: monthColumns.map((c) => [c.label, inrRound(c.value)]) }}
        empty={monthColumns.every((c) => c.value === 0) ? <p className="text-sm text-muted-foreground">No spending yet.</p> : undefined}
      >
        <ColumnChart data={monthColumns} onSelect={(c) => navigate(transactionsLink(monthSpan(c.key, tz)))} />
      </ChartCard>

      <ChartCard
        className="col-span-12 lg:col-span-5"
        title="Spending vs budget"
        description={bvs.data?.budgetPaise ? `Last six months against your ${inrRound(bvs.data.budgetPaise)} monthly budget.` : 'Last six months of net spending.'}
        isPending={bvs.isPending}
        error={bvs.error}
        onRetry={() => bvs.refetch()}
        table={{ columns: ['Month', 'Net spend'], rows: budgetColumns.map((c) => [c.label, inrRound(c.value)]) }}
        action={bvs.data?.budgetPaise ? undefined : <Button asChild size="xs" variant="secondary"><Link to="/budgets">Set a budget</Link></Button>}
      >
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <ColumnChart data={budgetColumns} onSelect={(c) => navigate(transactionsLink(monthSpan(c.key, tz)))} refLine={bvs.data?.budgetPaise ? { value: bvs.data.budgetPaise, label: 'Budget' } : undefined} />
          </div>
          {bvs.data?.budgetPaise ? <Legend className="mt-2" items={[{ key: 'ok', label: 'Within budget', color: 'var(--series-1)' }, { key: 'over', label: 'Over budget', color: 'var(--status-serious)' }]} /> : null}
        </div>
      </ChartCard>

      <ChartCard
        className="col-span-12 lg:col-span-7"
        title={granularity === 'day' ? 'Daily spending' : 'Weekly spending'}
        description={`${inrRound(dailyAvg)} average per ${granularity}. Select a ${granularity} to see what you bought.`}
        isPending={daily.isPending}
        isFetching={daily.isFetching}
        error={daily.error}
        onRetry={() => daily.refetch()}
        table={{ columns: [granularity === 'day' ? 'Day' : 'Week of', 'Net spend'], rows: dailyColumns.map((c) => [c.label, inrRound(c.value)]) }}
      >
        <ColumnChart
          data={dailyColumns}
          refLine={{ value: dailyAvg, label: 'Average' }}
          onSelect={(c) => navigate(transactionsLink(granularity === 'day' ? { from: c.key, to: c.key } : { from: c.key, to: new Date(new Date(`${c.key}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10) }))}
        />
      </ChartCard>

      <ChartCard
        className="col-span-12 lg:col-span-5"
        title="This month vs last"
        description="Cumulative spending, day by day."
        isPending={mom.isPending}
        error={mom.error}
        onRetry={() => mom.refetch()}
        table={{ columns: ['Day', mom.data?.currentLabel ?? 'This month', mom.data?.previousLabel ?? 'Last month'], rows: (mom.data?.points ?? []).map((p) => [p.day, p.currentPaise === null ? '—' : inrRound(p.currentPaise), p.previousPaise === null ? '—' : inrRound(p.previousPaise)]) }}
      >
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <MomLines data={mom.data?.points ?? []} currentLabel={mom.data?.currentLabel ?? 'This month'} previousLabel={mom.data?.previousLabel ?? 'Last month'} />
          </div>
          <Legend className="mt-2" items={[{ key: 'c', label: mom.data?.currentLabel ?? 'This month', color: 'var(--series-1)' }, { key: 'p', label: mom.data?.previousLabel ?? 'Last month', color: 'var(--chart-muted)' }]} />
        </div>
      </ChartCard>

      {/* ── recent activity: the inverse sheet ──────────────────────────────────────────────── */}
      <section aria-label="Recent activity" className="sheet-surface col-span-12 rounded-[32px] p-5 shadow-card sm:p-7">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-current opacity-15 sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">Recent activity</h2>
          <Button asChild variant="default" size="sm"><Link to={link()}>View all <ArrowRight /></Link></Button>
        </div>
        {recent.isPending ? (
          <div className="mt-5 space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} compact />
        ) : grouped.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No transactions match these filters.</p>
        ) : (
          <div className={cn('mt-5 space-y-5', recent.isFetching && 'opacity-60')}>
            {grouped.map((g) => (
              <div key={g.day}>
                <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{g.heading}</h3>
                {g.items.map((t) => <TxnRow key={t.id} t={t} tz={tz} onOpen={openView} />)}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


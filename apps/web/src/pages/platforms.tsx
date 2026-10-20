import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleDashed, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { BaselineRangeDto, PlatformWithStatsDto, RangeDto } from '@spendly/shared';
import { Delta } from '@/components/common/chips';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, PageHeader, SectionTitle } from '@/components/common/states';
import { Sparkline } from '@/components/charts/lines';
import { PlatformDialog } from '@/components/platforms/platform-dialog';
import { RulesPanel } from '@/components/platforms/rules-panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { transactionsLink, useFilters } from '@/lib/filters';
import { inrRound, plural } from '@/lib/format';

interface Unassigned {
  netPaise: number;
  count: number;
  previousNetPaise: number;
  changePct: number | null;
  sparkline: number[];
}
interface Response {
  range: RangeDto;
  baseline: BaselineRangeDto;
  platforms: PlatformWithStatsDto[];
  groups: string[];
  unassigned: Unassigned;
  monthLabels: string[];
}

function PlatformCard({ p }: { p: PlatformWithStatsDto }) {
  const s = p.stats;
  return (
    <Link to={`/platforms/${p.slug}`} className="lift flex flex-col gap-4 rounded-[28px] bg-tile p-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
      <div className="flex items-start gap-3">
        <PlatformLogo platform={p} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{p.name}</p>
          <p className="truncate text-xs text-muted-foreground">{p.isCustom ? 'Custom platform' : p.verification === 'probable' ? 'May appear under another name' : p.group}</p>
        </div>
        {s.changePct !== null && Math.abs(s.changePct) >= 1 && <Delta value={s.changePct} />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Money paise={s.netPaise} size="lg" />
          <p className="mt-1.5 text-xs text-muted-foreground">{plural(s.count, 'transaction')} · avg {inrRound(s.avgPaise)}</p>
        </div>
        <Sparkline values={s.sparkline} />
      </div>
    </Link>
  );
}

export default function Platforms() {
  const { rangeParams } = useFilters();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'rules' ? 'rules' : 'platforms';
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const data = useQuery({ queryKey: ['platforms', 'list', rangeParams], queryFn: () => api.get<Response>('/platforms', rangeParams), placeholderData: keepPreviousData, enabled: tab === 'platforms' });
  const d = data.data;
  const span = d ? { from: d.range.fromDate, to: d.range.toDate } : rangeParams;

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const match = (p: PlatformWithStatsDto) => !needle || p.name.toLowerCase().includes(needle) || p.group.toLowerCase().includes(needle) || p.aliases.some((a) => a.toLowerCase().includes(needle));
    return (d?.groups ?? [])
      .map((g) => {
        const all = d!.platforms.filter((p) => p.group === g && match(p));
        return { group: g, active: all.filter((p) => p.stats.count > 0), idle: all.filter((p) => p.stats.count === 0) };
      })
      .filter((g) => g.active.length + g.idle.length > 0);
  }, [d, search]);

  const activeTotal = d?.platforms.filter((p) => p.stats.count > 0).length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platforms"
        subtitle="Spending by brand, recognised from your statements and receipts. Spendly never signs in to these services or asks for their passwords."
        actions={<Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus /> Custom platform</Button>}
      />

      <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'rules') n.set('tab', 'rules'); else n.delete('tab'); return n; }, { replace: true })}>
        <TabsList aria-label="Platforms or rules">
          <TabsTrigger value="platforms">Platforms</TabsTrigger>
          <TabsTrigger value="rules">Recognition rules</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'rules' ? (
        <RulesPanel />
      ) : data.isError ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : (
        <>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search platforms" aria-label="Search platforms" className="h-11 rounded-full bg-card pl-11" />
          </div>

          {data.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36 rounded-[28px]" />)}</div>
          ) : (
            <div className="space-y-7" aria-busy={data.isFetching || undefined}>
              {!search && d && (d.unassigned.count > 0 || activeTotal === 0) && (
                <section className="space-y-3">
                  <SectionTitle>Not tied to a platform</SectionTitle>
                  <Link to={transactionsLink(span, { platform: 'none' })} className="flex flex-wrap items-center gap-4 rounded-[28px] border border-dashed bg-card p-4 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
                    <PlatformLogo platform={null} size={44} />
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-medium">Other / unassigned</p>
                      <p className="text-[13px] text-muted-foreground">Shops, people and anything the directory does not recognise. Add a rule or a custom platform to name them.</p>
                    </div>
                    <div className="text-right">
                      <Money paise={d.unassigned.netPaise} size="lg" />
                      <p className="mt-1.5 text-xs text-muted-foreground">{plural(d.unassigned.count, 'transaction')}</p>
                    </div>
                  </Link>
                </section>
              )}

              {grouped.length === 0 ? (
                <EmptyState className="rounded-[28px] border bg-card" icon={CircleDashed} title="No platform matches" description="Try a different name, or add a custom platform for it." action={{ label: 'Add custom platform', onClick: () => setAdding(true) }} />
              ) : (
                grouped.map((g) => (
                  <section key={g.group} className="space-y-3" aria-label={g.group}>
                    <SectionTitle action={<span className="text-xs text-muted-foreground">{g.active.length ? `${g.active.length} active` : 'No activity'}</span>}>{g.group}</SectionTitle>
                    {g.active.length > 0 && <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.active.map((p) => <PlatformCard key={p.slug} p={p} />)}</div>}
                    {g.idle.length > 0 && (
                      <ul className="flex flex-wrap gap-2" aria-label={`${g.group} with no spending in this period`}>
                        {g.idle.map((p) => (
                          <li key={p.slug}>
                            <Link to={`/platforms/${p.slug}`} className="flex items-center gap-2 rounded-full border bg-card py-1.5 pr-4 pl-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                              <PlatformLogo platform={p} size={26} />
                              {p.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))
              )}
            </div>
          )}
        </>
      )}
      {adding && <PlatformDialog open onOpenChange={setAdding} />}
    </div>
  );
}

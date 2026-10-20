import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ExternalLink, Minus, Pencil, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { BaselineRangeDto, InsightDto, PlatformDto, RangeDto, TransactionDto, TrendPointDto } from '@spendly/shared';
import { Delta } from '@/components/common/chips';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, SectionTitle } from '@/components/common/states';
import { ChartCard } from '@/components/charts/chart-frame';
import { ColumnChart, type Column } from '@/components/charts/columns';
import { InsightCard } from '@/components/coach/insight-card';
import { PlatformDialog } from '@/components/platforms/platform-dialog';
import { useTransactionPanel } from '@/components/transactions/transaction-panel';
import { TxnRow } from '@/components/transactions/txn-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { api } from '@/lib/api';
import { transactionsLink, useFilters } from '@/lib/filters';
import { inrRound, monthSpan, plural } from '@/lib/format';

interface Detail {
  platform: PlatformDto;
  range: RangeDto;
  baseline: BaselineRangeDto;
  stats: { netPaise: number; grossPaise: number; refundsPaise: number; count: number; avgPaise: number; previousNetPaise: number; changePct: number | null };
  monthly: TrendPointDto[];
  ordersPerMonth: number | null;
  weekendSharePct: number | null;
  lateNightOrders: number | null;
  recent: TransactionDto[];
  insights: InsightDto[];
}

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-[24px] bg-tile p-4">
      <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">{label}</p>
      <div className="mt-2 type-lg text-[22px] leading-none tnum">{children}</div>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Source({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px]">
      <span className={ok ? 'mt-px grid size-5 shrink-0 place-items-center rounded-full bg-ok-soft text-ok' : 'mt-px grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground'}>
        {ok ? <Check className="size-3" strokeWidth={3} aria-hidden /> : <Minus className="size-3" strokeWidth={3} aria-hidden />}
        <span className="sr-only">{ok ? 'Supported' : 'Not available'}</span>
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function PlatformDetail() {
  const { slug = '' } = useParams();
  const { prefs } = useSession();
  const tz = prefs.timezone;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const { rangeParams } = useFilters();
  const { openView } = useTransactionPanel();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const q = useQuery({ queryKey: ['platforms', 'detail', slug, rangeParams], queryFn: () => api.get<Detail>(`/platforms/${slug}`, rangeParams) });
  const del = useMutation({
    mutationFn: () => api.delete<{ transactionsUnassigned: number }>(`/platforms/${slug}`),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      await invalidate();
      toast.success(`Platform removed — ${plural(r.transactionsUnassigned, 'transaction')} now unassigned`);
      navigate('/platforms', { replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete the platform'),
  });

  if (q.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild><Link to="/platforms"><ArrowLeft /> Platforms</Link></Button>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const p = d?.platform;
  const span = d ? { from: d.range.fromDate, to: d.range.toDate } : rangeParams;
  const columns: Column[] = (d?.monthly ?? []).map((m, i, all) => ({ key: m.key, label: m.label, value: m.netPaise, dim: i !== all.length - 1, color: p?.color, extra: [{ label: 'Transactions', value: String(m.count) }] }));
  const sources = p?.sources;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground"><Link to="/platforms"><ArrowLeft /> Platforms</Link></Button>

      <section className="grain relative overflow-hidden rounded-[32px] border bg-card p-5 shadow-card sm:p-7" aria-label={p ? `${p.name} summary` : 'Platform summary'}>
        {p && <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full opacity-25 blur-2xl" style={{ background: `radial-gradient(closest-side, ${p.color}, transparent)` }} />}
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {p ? <PlatformLogo platform={p} size={64} /> : <Skeleton className="size-16 rounded-full" />}
            <div className="min-w-0">
              {p ? <h1 className="type-title truncate text-[27px] leading-none sm:text-[33px]">{p.name}</h1> : <Skeleton className="h-8 w-48" />}
              {p && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  {p.group}
                  <Badge variant={p.verification === 'verified' ? 'ok' : 'default'}>
                    {p.verification === 'verified' ? 'Recognised brand' : p.verification === 'probable' ? 'Often listed under another name' : 'Custom platform'}
                  </Badge>
                  {p.website && (
                    <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                      Website <ExternalLink className="size-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
          {p?.isCustom && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
              <Button size="sm" variant="secondary" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button>
            </div>
          )}
        </div>

        <div className="relative mt-7 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Spent · {d?.range.label ?? '…'}</p>
            <div className="mt-3">{d ? <Money paise={d.stats.netPaise} size="hero" /> : <Skeleton className="h-[72px] w-64 rounded-2xl" />}</div>
          </div>
          {d && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <Delta value={d.stats.changePct} />
              <span className="text-[13px] text-muted-foreground">vs {inrRound(d.stats.previousNetPaise)} {d.baseline.baselineLabel.toLowerCase()}</span>
            </div>
          )}
        </div>
        {p?.note && <p className="relative mt-4 max-w-prose text-[13px] text-muted-foreground">{p.note}</p>}
        {d && d.stats.refundsPaise > 0 && <p className="relative mt-3 text-[13px] text-muted-foreground">Net of {inrRound(d.stats.refundsPaise)} refunded — purchases were {inrRound(d.stats.grossPaise)}.</p>}
        {p && <div className="relative mt-6"><Button asChild><Link to={transactionsLink(span, { platform: slug })}>View transactions</Link></Button></div>}
      </section>

      {d && d.stats.count === 0 && d.monthly.every((m) => m.count === 0) ? (
        <EmptyState className="rounded-[28px] border bg-card" title={`Nothing from ${d.platform.name} yet`} description="Import a statement or add a transaction. Anything that mentions this platform will be matched automatically." action={{ label: 'Import a statement', to: '/import' }} />
      ) : (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Transactions">{d ? d.stats.count.toLocaleString('en-IN') : <Skeleton className="h-6 w-12" />}</Stat>
            <Stat label="Average">{d ? <Money paise={d.stats.avgPaise} size="lg" /> : <Skeleton className="h-6 w-20" />}</Stat>
            <Stat label="Per month" note="Over months with activity">{d ? (d.ordersPerMonth ?? '—') : <Skeleton className="h-6 w-12" />}</Stat>
            <Stat label="On weekends" note="Share of spend">{d ? (d.weekendSharePct !== null ? `${d.weekendSharePct}%` : '—') : <Skeleton className="h-6 w-12" />}</Stat>
            <Stat label="Late night" note={d?.lateNightOrders === null ? 'Needs times on transactions' : '11 pm – 4 am'}>{d ? (d.lateNightOrders ?? '—') : <Skeleton className="h-6 w-12" />}</Stat>
          </section>

          <ChartCard
            title="Last 12 months"
            description="Net spending by month. Select a month to see its transactions."
            isPending={q.isPending}
            table={{ columns: ['Month', 'Net spend', 'Transactions'], rows: (d?.monthly ?? []).map((m) => [m.label, inrRound(m.netPaise), m.count]) }}
          >
            <ColumnChart data={columns} color={p?.color ?? 'var(--series-1)'} onSelect={(c) => navigate(transactionsLink(monthSpan(c.key, tz), { platform: slug }))} />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <section className="rounded-[32px] border bg-card p-5 shadow-card sm:p-6" aria-label="Recent transactions">
              <SectionTitle action={<Button size="xs" variant="ghost" asChild><Link to={transactionsLink(span, { platform: slug })}>View all</Link></Button>}>Recent</SectionTitle>
              <div className="mt-3 space-y-0.5">
                {d ? d.recent.length ? d.recent.map((t) => <TxnRow key={t.id} t={t} tz={tz} onOpen={openView} showDate />) : <p className="py-6 text-center text-sm text-muted-foreground">No transactions yet.</p> : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="my-1 h-14 rounded-2xl" />)}
              </div>
            </section>
            <div className="space-y-4">
              {d && d.insights.length > 0 && (
                <section aria-label="Insights" className="space-y-3">
                  <SectionTitle>Insights</SectionTitle>
                  {d.insights.slice(0, 2).map((i) => <InsightCard key={i.id} insight={i} compact />)}
                </section>
              )}
              {sources && (
                <Card className="gap-3" aria-label="Where this platform's data comes from">
                  <h2 className="text-[15px] font-semibold tracking-tight">How Spendly sees {p?.name}</h2>
                  <ul className="space-y-2.5">
                    <Source ok={sources.bankStatement}>Bank, card and UPI statements{sources.bankStatement ? '' : ' — not applicable'}</Source>
                    <Source ok={sources.csv}>CSV and Excel exports you upload</Source>
                    <Source ok={sources.emailReceipts}>Receipt emails you export as .eml{sources.emailReceipts ? '' : ' — receipts are not parsed for this platform'}</Source>
                    <Source ok={sources.manual}>Entries you add yourself</Source>
                    <Source ok={false}>{sources.officialApi === 'partner_only' ? 'A partner-only API exists, but it is not open to personal accounts' : 'No public API for your own order history'}</Source>
                  </ul>
                  <p className="text-xs text-muted-foreground">{sources.note} Spendly never signs in to {p?.name}, scrapes your account or asks for its password.</p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {p?.isCustom && editing && <PlatformDialog open onOpenChange={setEditing} platform={p} />}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${p?.name ?? 'this platform'}?`} description="Its transactions are kept, but they become “Other / unassigned”. Rules that pointed at it stop assigning a platform." confirmLabel="Delete platform" destructive pending={del.isPending} onConfirm={() => del.mutate()} />
    </div>
  );
}

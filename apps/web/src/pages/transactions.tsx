import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, Plus, Repeat, Search, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DuplicateGroupDto, PageMeta, PeriodTotals, TransactionDto } from '@spendly/shared';
import { PAYMENT_METHOD_LABELS } from '@spendly/shared';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { FilterBar } from '@/components/common/filter-bar';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/states';
import { useTransactionPanel } from '@/components/transactions/transaction-panel';
import { TxnAmount, TxnRow } from '@/components/transactions/txn-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { useIsDesktop, useMediaQuery } from '@/hooks/use-media-query';
import { api } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { dayHeading, dayKey, formatDate, formatTime, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type Result = { items: TransactionDto[]; meta: PageMeta; totals: PeriodTotals };
type SortKey = 'date' | 'amount' | 'merchant';

function SortHead({ label, k, sort, order, onSort, className }: { label: string; k: SortKey; sort: SortKey; order: 'asc' | 'desc'; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </TableHead>
  );
}

function DuplicatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { prefs } = useSession();
  const q = useQuery({ queryKey: ['transactions', 'duplicates'], queryFn: () => api.get<DuplicateGroupDto[]>('/transactions/duplicates'), enabled: open });
  const resolve = useMutation({
    mutationFn: (v: { keepId: string; removeIds: string[]; dismiss: boolean }) => api.post('/transactions/duplicates/resolve', v),
    onSuccess: (_d, v) => {
      toast.success(v.dismiss ? 'Kept both — marked as not a duplicate' : 'Duplicate removed');
      void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== 'me' && x.queryKey[0] !== 'catalog' });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resolve'),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Possible duplicates</DialogTitle>
          <DialogDescription>Same amount, a day apart or less, and a similar merchant. Genuine repeat purchases exist — you decide.</DialogDescription>
        </DialogHeader>
        {q.isPending ? <Skeleton className="h-40 w-full rounded-2xl" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : q.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No possible duplicates. Nice and tidy.</p>
        ) : (
          <ul className="space-y-3">
            {q.data.map((g) => (
              <li key={g.id} className="rounded-3xl border p-4">
                <p className="mb-3 text-xs text-muted-foreground">{g.reasons.join(' · ')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.transactions.map((t, i) => (
                    <div key={t.id} className="rounded-2xl bg-muted/60 px-3.5 py-3">
                      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{i === 0 ? 'Original' : 'Possible duplicate'}</p>
                      <p className="mt-1 truncate text-sm font-medium">{t.merchantName}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(t.date, prefs.timezone, 'long')}{t.hasTime && ` · ${formatTime(t.date, prefs.timezone)}`}</p>
                      <TxnAmount t={t} className="mt-1" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ keepId: g.transactions[0]!.id, removeIds: [g.transactions[1]!.id], dismiss: false })}><Trash2 /> Delete the duplicate</Button>
                  <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ keepId: g.transactions[0]!.id, removeIds: [g.transactions[1]!.id], dismiss: true })}>Keep both</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkBar({ ids, onClear, onDone }: { ids: string[]; onClear: () => void; onDone: () => void }) {
  const cat = useCatalog();
  const [dialog, setDialog] = useState<'category' | 'tag' | 'delete' | null>(null);
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ modified: number }>('/transactions/bulk', { ids, ...body }),
    onSuccess: (r) => {
      toast.success(`${plural(r.modified, 'transaction')} updated`);
      setDialog(null);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update'),
  });
  return (
    <>
      {/* portalled to the body: the routed page it would otherwise render inside carries a filling
          page-enter animation, which (even once finished) keeps transform off `none` and silently
          turns position:fixed descendants into something positioned by that page element instead
          of the viewport — the same reason Dialog/Sheet/Drawer in this app portal too. */}
      {createPortal(
        <div role="toolbar" aria-label="Bulk actions" className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-[28px] border bg-popover/95 p-2.5 pl-5 shadow-2xl backdrop-blur md:bottom-6">
          <span className="mr-auto text-sm font-medium">{ids.length} selected</span>
          <Button size="sm" variant="secondary" onClick={() => setDialog('category')}><Tag /> Categorize</Button>
          <Button size="sm" variant="secondary" onClick={() => run.mutate({ action: 'confirm_classification' })}>Mark reviewed</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('tag')}>Add tag</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('delete')}><Trash2 /></Button>
          <Button size="icon-sm" variant="ghost" onClick={onClear} aria-label="Clear selection"><X /></Button>
        </div>,
        document.body,
      )}
      <Dialog open={dialog === 'category'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Categorize {ids.length}</DialogTitle><DialogDescription>Applies one category to every selected transaction.</DialogDescription></DialogHeader>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
            <SelectContent className="max-h-72">{cat.categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button disabled={!category || run.isPending} onClick={() => run.mutate({ action: 'categorize', category })}>Apply</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === 'tag'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add a tag to {ids.length}</DialogTitle><DialogDescription>Tags help you group things like “trip” or “office”.</DialogDescription></DialogHeader>
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. trip" maxLength={30} />
          <DialogFooter><Button disabled={!tag.trim() || run.isPending} onClick={() => run.mutate({ action: 'add_tag', tag: tag.trim() })}>Add tag</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} title={`Delete ${plural(ids.length, 'transaction')}?`} description="They are removed from your records and totals. This cannot be undone." confirmLabel="Delete" destructive pending={run.isPending} onConfirm={() => run.mutate({ action: 'delete' })} />
    </>
  );
}

export default function Transactions() {
  const { prefs } = useSession();
  const tz = prefs.timezone;
  const cat = useCatalog();
  const { openView, openNew } = useTransactionPanel();
  const { range, rangeParams, apiParams, filters, params, setParams } = useFilters();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dupes, setDupes] = useState(false);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const roomy = useMediaQuery('(min-width: 640px)');
  const isDesktop = useIsDesktop();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page = Number(params.get('page') ?? 1) || 1;
  const pageSize = Number(params.get('pageSize') ?? 25) || 25;
  const sort = (['date', 'amount', 'merchant'].includes(params.get('sort') ?? '') ? params.get('sort') : 'date') as SortKey;
  const order = (params.get('order') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
  const flags = { needsReview: params.get('needsReview') === 'true' ? 'true' : undefined, duplicates: params.get('duplicates') === 'true' ? 'true' : undefined, recurring: params.get('recurring') === 'true' ? 'true' : undefined };
  const q = params.get('q') ?? '';

  // the PWA shortcut "Add a transaction" opens the panel once
  useEffect(() => {
    if (params.get('new') === '1') {
      openNew();
      setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true });
    }
  }, [params, openNew, setParams]);

  // "View imported transactions" is scoped to one import across all dates, so the date range is not applied
  const importJob = params.get('importJob') || undefined;
  const scope = importJob ? { category: filters.category, platform: filters.platform, paymentMethod: filters.paymentMethod, type: filters.type, importJob } : apiParams;
  const query = { ...scope, q: q || undefined, page, pageSize, sort, order, ...flags };
  const data = useQuery({ queryKey: ['transactions', 'list', query], queryFn: () => api.get<Result>('/transactions', query), placeholderData: keepPreviousData });

  const set = (patch: Record<string, string | null>) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(k); else n.set(k, v); } if (!('page' in patch)) n.delete('page'); return n; }, { replace: true });
  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => set({ q: v.trim() || null }), 300);
  };
  const onSort = (k: SortKey) => set({ sort: k, order: sort === k ? (order === 'asc' ? 'desc' : 'asc') : k === 'merchant' ? 'asc' : 'desc' });
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const meta = data.data?.meta;
  const totals = data.data?.totals;
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const clearSel = () => setSelected(new Set());
  const refresh = () => { clearSel(); void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] !== 'me' && x.queryKey[0] !== 'catalog' }); };

  const grouped = useMemo(() => {
    const out: Array<{ day: string; heading: string; items: TransactionDto[] }> = [];
    for (const t of items) {
      const k = dayKey(t.date, tz);
      const last = out[out.length - 1];
      if (last?.day === k) last.items.push(t);
      else out.push({ day: k, heading: dayHeading(t.date, tz), items: [t] });
    }
    return out;
  }, [items, tz]);

  const exportCsv = () => api.download('/transactions/export', { ...rangeParams, ...Object.fromEntries(Object.entries(apiParams).filter(([k]) => ['category', 'platform', 'paymentMethod', 'type'].includes(k))) } as never, 'spendly-transactions.csv').catch((e) => toast.error(e instanceof Error ? e.message : 'Export failed'));
  const toggleFlag = (key: 'needsReview' | 'duplicates' | 'recurring') => set({ [key]: flags[key] ? null : 'true' });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transactions"
        subtitle={meta ? `${plural(meta.total, 'transaction')} in this view` : 'Your complete ledger'}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={exportCsv}><Download /> Export CSV</Button>
            <Button size="sm" onClick={() => openNew()} className="hidden md:inline-flex"><Plus /> Add</Button>
          </>
        }
      />

      {totals && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[28px] border bg-card px-5 py-4 shadow-card" aria-live="polite">
          <div><p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Net spending</p><Money paise={totals.netPaise} size="lg" className="mt-1" /></div>
          <div><p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Purchases</p><Money paise={totals.grossPaise} size="md" className="mt-1.5" /></div>
          {totals.refundsPaise > 0 && <div><p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Refunds</p><Money paise={totals.refundsPaise} size="md" className="mt-1.5 text-ok" /></div>}
          {prefs.incomeTracking && totals.incomePaise > 0 && <div><p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Income</p><Money paise={totals.incomePaise} size="md" className="mt-1.5 text-ok" /></div>}
          <p className="ml-auto text-xs text-muted-foreground">Totals count completed transactions; transfers are excluded.</p>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={roomy ? 'Search merchant, platform, amount or date' : 'Search transactions'} aria-label="Search transactions" className="h-11 rounded-full bg-card pl-11" />
          </div>
          <Select value={`${sort}:${order}`} onValueChange={(v) => { const [s, o] = v.split(':'); set({ sort: s!, order: o! }); }}>
            <SelectTrigger className="h-11 w-auto rounded-full bg-card md:hidden" aria-label="Sort by"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date:desc">Newest first</SelectItem><SelectItem value="date:asc">Oldest first</SelectItem>
              <SelectItem value="amount:desc">Largest first</SelectItem><SelectItem value="amount:asc">Smallest first</SelectItem>
              <SelectItem value="merchant:asc">Merchant A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FilterBar />
        {importJob && (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            Showing what one import added, across all dates.
            <Button size="xs" variant="secondary" onClick={() => set({ importJob: null })}>Show everything</Button>
          </p>
        )}
        <div className="scrollbar-none relative -mx-3 flex snap-x gap-2 overflow-x-auto scroll-px-3 px-3 py-1 *:shrink-0 *:snap-start md:mx-0 md:flex-wrap md:overflow-visible md:p-0" role="group" aria-label="Quick views">
          {([['needsReview', 'Needs review', CircleHelp], ['duplicates', 'Possible duplicates', Copy], ['recurring', 'Recurring', Repeat]] as const).map(([k, label, Icon]) => (
            <Button key={k} size="sm" variant={flags[k] ? 'default' : 'outline'} aria-pressed={Boolean(flags[k])} onClick={() => toggleFlag(k)} className="h-9"><Icon /> {label}</Button>
          ))}
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setDupes(true)}>Resolve duplicates…</Button>
        </div>
      </div>

      {data.isError ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : data.isPending ? (
        <div className="space-y-2 rounded-[32px] border bg-card p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState className="rounded-[32px] border bg-card" title="No transactions here" description={q || range.preset ? 'Nothing matches these filters. Try a wider date range or clear a filter.' : 'Add a transaction or import a statement to get started.'} action={{ label: 'Add a transaction', onClick: () => openNew() }} secondary={{ label: 'Import a statement', to: '/import' }} />
      ) : (
        <>
          {/* only the layout in use is built: a CSS-hidden 100-row table is still 100 rows of DOM (and logos) on a phone */}
          {isDesktop ? (
            <div className={cn('overflow-hidden rounded-[32px] border bg-card shadow-card', data.isFetching && 'opacity-70 transition-opacity')}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 pl-5"><label className="-m-2 grid w-max cursor-pointer place-items-center p-2"><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((t) => t.id)) : new Set())} className="size-4 accent-[var(--series-1)]" /></label></TableHead>
                    <SortHead label="Merchant" k="merchant" sort={sort} order={order} onSort={onSort} />
                    <TableHead className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:table-cell">Category</TableHead>
                    <TableHead className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:table-cell">Paid with</TableHead>
                    <SortHead label="Date" k="date" sort={sort} order={order} onSort={onSort} />
                    <SortHead label="Amount" k="amount" sort={sort} order={order} onSort={onSort} className="pr-5 text-right [&>button]:ml-auto" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => {
                    const platform = cat.platform(t.platform);
                    const category = cat.category(t.category);
                    return (
                      <TableRow key={t.id} data-state={selected.has(t.id) ? 'selected' : undefined} className="cursor-pointer" onClick={() => openView(t.id)}>
                        <TableCell className="pl-5" onClick={(e) => e.stopPropagation()}><label className="-m-2 grid w-max cursor-pointer place-items-center p-2"><input type="checkbox" aria-label={`Select ${t.merchantName}`} checked={selected.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} className="size-4 accent-[var(--series-1)]" /></label></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {platform ? <PlatformLogo platform={platform} size={38} /> : <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={38} />}
                            <div className="min-w-0">
                              <button type="button" onClick={(e) => { e.stopPropagation(); openView(t.id); }} className="flex items-center gap-1.5 text-left text-sm font-medium outline-none hover:underline focus-visible:underline">
                                <span className="max-w-[16rem] truncate">{t.merchantName}</span>
                                {t.classification.needsReview && <><CircleHelp className="size-3.5 text-[var(--status-warning)]" aria-hidden /><span className="sr-only">Needs review</span></>}
                                {t.duplicateStatus === 'possible' && <><Copy className="size-3.5 text-[var(--status-serious)]" aria-hidden /><span className="sr-only">Possible duplicate</span></>}
                                {t.recurringPaymentId && <><Repeat className="size-3.5 opacity-50" aria-hidden /><span className="sr-only">Recurring</span></>}
                              </button>
                              {t.platformName && t.platformName !== t.merchantName && <p className="truncate text-xs text-muted-foreground">{t.platformName}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-sm lg:table-cell">{t.categoryName ?? <span className="text-muted-foreground">Uncategorized</span>}</TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{PAYMENT_METHOD_LABELS[t.paymentMethod]}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                          {formatDate(t.date, tz, 'long')}
                          {t.status !== 'completed' && <Badge variant="warn" className="ml-2">{t.status}</Badge>}
                          {t.type === 'transfer' && <Badge className="ml-2">Transfer</Badge>}
                        </TableCell>
                        <TableCell className="pr-5 text-right"><TxnAmount t={t} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className={cn('space-y-5 rounded-[32px] border bg-card p-3 shadow-card', data.isFetching && 'opacity-70')}>
              {grouped.map((g) => (
                <div key={g.day}>
                  <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{g.heading}</h3>
                  {g.items.map((t) => <TxnRow key={t.id} t={t} tz={tz} onOpen={openView} selected={selected.has(t.id)} onSelect={(c) => toggle(t.id, c)} />)}
                </div>
              ))}
            </div>
          )}

          {meta && (
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Showing {((meta.page - 1) * meta.pageSize + 1).toLocaleString('en-IN')}–{Math.min(meta.page * meta.pageSize, meta.total).toLocaleString('en-IN')} of {meta.total.toLocaleString('en-IN')}</p>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(v) => set({ pageSize: v })}>
                  <SelectTrigger className="h-10 w-[7.5rem] rounded-full bg-card" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent>{[25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="secondary" size="icon" className="size-10" disabled={meta.page <= 1} onClick={() => set({ page: String(meta.page - 1) })} aria-label="Previous page"><ChevronLeft /></Button>
                <span className="tnum min-w-16 text-center text-sm">{meta.page} / {meta.totalPages}</span>
                <Button variant="secondary" size="icon" className="size-10" disabled={meta.page >= meta.totalPages} onClick={() => set({ page: String(meta.page + 1) })} aria-label="Next page"><ChevronRight /></Button>
              </div>
            </nav>
          )}
        </>
      )}

      {selected.size > 0 && <BulkBar ids={[...selected]} onClear={clearSel} onDone={refresh} />}
      <DuplicatesDialog open={dupes} onOpenChange={setDupes} />
    </div>
  );
}

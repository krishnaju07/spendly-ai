import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight, CircleAlert, Copy, Download, FileQuestion, Pencil, Search, TriangleAlert } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, rupeesToPaise, type ImportJobDto, type ImportRecordDto, type ImportStatsDto, type Paged } from '@spendly/shared';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { ConfidenceBadge, confidenceLevel } from '@/components/common/chips';
import { Field } from '@/components/common/field';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState } from '@/components/common/states';
import { TxnAmount } from '@/components/transactions/txn-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiRequestError, api } from '@/lib/api';
import { formatDate, formatTime, inrRound, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'valid' | 'uncertain' | 'duplicate' | 'invalid';

const TABS: Array<{ id: Tab; label: string; count: (s: ImportStatsDto) => number; hint: string }> = [
  { id: 'uncertain', label: 'Check these', count: (s) => s.uncertain, hint: 'Spendly is not sure about the platform or category. Confirm, fix or skip each one.' },
  { id: 'duplicate', label: 'Possible duplicates', count: (s) => s.duplicates, hint: 'These look like transactions you already have, or repeat inside this file. Choose what to do with each.' },
  { id: 'valid', label: 'Ready', count: (s) => s.valid, hint: 'Recognised with good confidence and not seen before.' },
  { id: 'invalid', label: 'Problems', count: (s) => s.invalid, hint: 'These rows cannot be imported as they are. Fix a row to include it, or leave it out — the reasons are listed.' },
];

const rawSnippet = (raw: Record<string, string>) => Object.values(raw).filter(Boolean).slice(0, 5).join(' · ').slice(0, 160) || 'Empty row';

// ── editing a row ──────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  merchant: z.string().trim().min(1, 'Enter the merchant').max(120),
  amount: z.string().refine((v) => {
    try {
      return rupeesToPaise(v) > 0;
    } catch {
      return false;
    }
  }, 'Enter an amount above zero'),
  date: z.string().min(1, 'Choose a date'),
  type: z.enum(TRANSACTION_TYPES),
  platform: z.string(),
  category: z.string(),
  method: z.enum(PAYMENT_METHODS),
});
type Values = z.infer<typeof schema>;
const NONE = 'none';

function RecordDialog({ job, record, onClose }: { job: ImportJobDto; record: ImportRecordDto; onClose: () => void }) {
  const { prefs } = useSession();
  const tz = prefs.timezone;
  const cat = useCatalog();
  const qc = useQueryClient();
  const d = record.draft;
  const withTime = Boolean(d?.hasTime);
  const dateFmt = withTime ? "yyyy-LL-dd'T'HH:mm" : 'yyyy-LL-dd';
  const { register, handleSubmit, control, formState: { errors, dirtyFields } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      merchant: d?.merchantName ?? '',
      amount: d ? String(d.amountPaise / 100) : '',
      date: d ? DateTime.fromISO(d.date, { zone: tz }).toFormat(dateFmt) : '', // a row that could not be read must be dated on purpose, not by default
      type: d?.type ?? 'expense',
      platform: d?.platform ?? NONE,
      category: d?.category ?? NONE,
      method: d?.paymentMethod ?? 'bank_transfer',
    },
  });
  const save = useMutation({
    mutationFn: (v: Values) => {
      const all = !d; // a row with nothing readable needs everything supplied
      const body: Record<string, unknown> = {};
      if (all || dirtyFields.merchant) body.merchantName = v.merchant;
      if (all || dirtyFields.amount) body.amountPaise = rupeesToPaise(v.amount);
      if (all || dirtyFields.date) body.date = (withTime ? DateTime.fromFormat(v.date, dateFmt, { zone: tz }) : DateTime.fromISO(`${v.date}T12:00`, { zone: tz })).toISO({ suppressMilliseconds: true });
      if (all || dirtyFields.type) body.type = v.type;
      if (all || dirtyFields.method) body.paymentMethod = v.method;
      if (dirtyFields.platform) body.platform = v.platform === NONE ? null : v.platform;
      if (dirtyFields.category) body.category = v.category === NONE ? null : v.category;
      body.decision = 'accepted';
      return api.patch<ImportRecordDto>(`/imports/${job.id}/records/${record.id}`, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['imports'] });
      toast.success('Row updated and set to import');
      onClose();
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save the row.' : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d ? `Edit row ${record.rowNumber}` : `Fix row ${record.rowNumber}`}</DialogTitle>
          <DialogDescription>{record.issues[0]?.message ?? 'Change anything that is wrong. Saving sets this row to be imported.'}</DialogDescription>
        </DialogHeader>
        <p className="rounded-2xl bg-muted/60 px-4 py-2.5 text-xs break-words text-muted-foreground"><span className="font-medium text-foreground">In your file: </span>{rawSnippet(record.raw)}</p>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Merchant" error={errors.merchant?.message} htmlFor="rr-merchant"><Input id="rr-merchant" autoFocus {...register('merchant')} aria-invalid={Boolean(errors.merchant)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" error={errors.amount?.message} htmlFor="rr-amount"><Input id="rr-amount" inputMode="decimal" {...register('amount')} aria-invalid={Boolean(errors.amount)} /></Field>
            <Field label={withTime ? 'Date and time' : 'Date'} error={errors.date?.message} htmlFor="rr-date"><Input id="rr-date" type={withTime ? 'datetime-local' : 'date'} {...register('date')} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Controller control={control} name="type" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TRANSACTION_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Paid with">
              <Controller control={control} name="method" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map((p) => <SelectItem key={p} value={p}>{PAYMENT_METHOD_LABELS[p]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Platform">
              <Controller control={control} name="platform" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72"><SelectItem value={NONE}>Other / unassigned</SelectItem>{cat.platforms.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Category">
              <Controller control={control} name="category" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72"><SelectItem value={NONE}>Uncategorized</SelectItem>{cat.categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
          </div>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save and import this row'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── one row ────────────────────────────────────────────────────────────────────────────────────

function RecordRow({ r, tz, busy, onDecide, onEdit }: { r: ImportRecordDto; tz: string; busy: boolean; onDecide: (d: 'accepted' | 'rejected') => void; onEdit: () => void }) {
  const cat = useCatalog();
  const d = r.draft;
  const platform = cat.platform(d?.platform);
  const category = cat.category(d?.category);
  const invalid = r.status === 'invalid';
  return (
    <li className={cn('rounded-3xl border bg-card p-4 shadow-card', r.decision === 'rejected' && 'opacity-60')}>
      <div className="flex items-start gap-3">
        {d ? (platform ? <PlatformLogo platform={platform} size={42} /> : <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={42} />) : <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-bad-soft text-bad"><FileQuestion className="size-5" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{d?.merchantName ?? 'Could not read this row'}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {d ? <>{formatDate(d.date, tz, 'long')}{d.hasTime && ` · ${formatTime(d.date, tz)}`} · {cat.categoryName(d.category)} · {PAYMENT_METHOD_LABELS[d.paymentMethod]}</> : rawSnippet(r.raw)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tnum">Row {r.rowNumber} of your file</p>
        </div>
        {d && <TxnAmount t={{ type: d.type, amountPaise: d.amountPaise, status: 'completed' }} />}
      </div>

      {(r.issues.length > 0 || r.duplicateOf || (r.classification?.needsReview && !invalid)) && (
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {r.issues.map((i, k) => <li key={k} className={cn('flex items-start gap-2', invalid ? 'text-bad' : 'text-warn')}>{invalid ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}{i.message}</li>)}
          {r.duplicateOf && <li className="flex items-start gap-2 text-warn"><Copy className="mt-0.5 size-4 shrink-0" aria-hidden />Looks the same as “{r.duplicateOf.merchantName}” on {formatDate(r.duplicateOf.date, tz, 'long')} for {inrRound(r.duplicateOf.amountPaise)}.</li>}
          {r.classification?.needsReview && !invalid && (
            <li className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <ConfidenceBadge level={confidenceLevel(r.classification.confidence)} score={r.classification.confidence} />
              {!r.issues.some((i) => i.message === r.classification?.reason) && <span>{r.classification.reason}</span>}
            </li>
          )}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {invalid ? (
          <Button size="sm" variant="secondary" onClick={onEdit}><Pencil /> Fix this row</Button>
        ) : (
          <>
            <div role="group" aria-label={`Row ${r.rowNumber}: import or skip`} className="inline-flex rounded-full bg-muted p-1">
              <button type="button" aria-pressed={r.decision === 'accepted'} disabled={busy} onClick={() => onDecide('accepted')} className={cn('rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', r.decision === 'accepted' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>Import</button>
              <button type="button" aria-pressed={r.decision === 'rejected'} disabled={busy} onClick={() => onDecide('rejected')} className={cn('rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', r.decision === 'rejected' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>Skip</button>
            </div>
            <Button size="sm" variant="ghost" onClick={onEdit}><Pencil /> Edit</Button>
            {r.decision === 'pending' && <span className="text-xs text-warn">Needs your decision</span>}
          </>
        )}
      </div>
    </li>
  );
}

// ── the review ─────────────────────────────────────────────────────────────────────────────────

export function ReviewStep({ job }: { job: ImportJobDto }) {
  const { prefs } = useSession();
  const qc = useQueryClient();
  const s = job.stats;
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked ?? TABS.find((t) => t.count(s) > 0)?.id ?? 'valid';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [editing, setEditing] = useState<ImportRecordDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<'skip' | 'import'>('skip');
  const [learn, setLearn] = useState(true);

  const records = useQuery({
    queryKey: ['imports', 'records', job.id, tab, page, q],
    queryFn: () => api.get<Paged<ImportRecordDto>>(`/imports/${job.id}/records`, { status: tab, page, pageSize: 25, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['imports'] });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accepted' | 'rejected' }) => api.patch(`/imports/${job.id}/records/${id}`, { decision }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change that row'),
  });
  const bulk = useMutation({
    mutationFn: (decision: 'accepted' | 'rejected') => api.post<{ modified: number }>(`/imports/${job.id}/records/bulk`, { decision, filter: { status: tab } }),
    onSuccess: async (r, decision) => {
      await refresh();
      toast.success(`${plural(r.modified, 'row')} set to ${decision === 'accepted' ? 'import' : 'skip'}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update those rows'),
  });
  const confirm = useMutation({
    mutationFn: () => api.post<ImportJobDto>(`/imports/${job.id}/confirm`, { pending: s.pending > 0 ? pending : undefined, learnConfirmed: learn }),
    onSuccess: async (j) => {
      qc.setQueryData(['imports', 'one', job.id], j);
      await refresh();
      setConfirming(false);
    },
  });
  const confirmError = confirm.error instanceof ApiRequestError ? confirm.error.message : confirm.error ? 'Could not start the import.' : null;

  const meta = records.data?.meta;
  const active = TABS.find((t) => t.id === tab)!;
  const toImport = s.accepted;
  const skippedByYou = Math.max(0, s.rejected - s.invalid);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-tile p-5">
        <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Nothing is saved yet</p>
        <p className="mt-2 text-sm">
          Spendly read <strong className="tnum">{plural(s.totalRows, 'row')}</strong>.{' '}
          <strong className="tnum">{plural(toImport, 'transaction')}</strong> will be imported
          {skippedByYou > 0 && <>, <span className="tnum">{skippedByYou}</span> skipped</>}
          {s.invalid > 0 && <>, <span className="tnum">{s.invalid}</span> could not be read (see Problems)</>}
          {s.pending > 0 && <>, and <span className="font-medium text-warn tnum">{s.pending}</span> need your decision</>}. Look through the tabs, fix or skip what is wrong, then import.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setPicked(v as Tab); setPage(1); }}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Review groups" className="w-max">
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label} ({t.count(s)})</TabsTrigger>)}
          </TabsList>
        </div>
      </Tabs>
      <p className="text-[13px] text-muted-foreground">{active.hint}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search rows" aria-label="Search rows" className="h-10 rounded-full bg-card pl-11" />
        </div>
        {tab !== 'invalid' ? (
          <>
            <Button size="sm" variant="secondary" disabled={bulk.isPending || (meta?.total ?? 0) === 0} onClick={() => bulk.mutate('accepted')}>Import all here</Button>
            <Button size="sm" variant="secondary" disabled={bulk.isPending || (meta?.total ?? 0) === 0} onClick={() => bulk.mutate('rejected')}>Skip all here</Button>
          </>
        ) : (
          s.invalid > 0 && <Button size="sm" variant="secondary" onClick={() => api.download(`/imports/${job.id}/errors.csv`, undefined, 'import-errors.csv').catch((e) => toast.error(e instanceof Error ? e.message : 'Download failed'))}><Download /> Error report (CSV)</Button>
        )}
      </div>

      {records.isError ? <ErrorState error={records.error} onRetry={() => records.refetch()} compact /> : records.isPending ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}</div>
      ) : records.data.items.length === 0 ? (
        <EmptyState compact className="rounded-3xl border bg-card" title={q ? 'No rows match that search' : 'Nothing in this group'} description={q ? undefined : tab === 'invalid' ? 'Every row could be read.' : 'Try another tab.'} />
      ) : (
        <ul className={cn('space-y-2.5 transition-opacity', records.isFetching && 'opacity-60')} aria-busy={records.isFetching || undefined}>
          {records.data.items.map((r) => <RecordRow key={r.id} r={r} tz={prefs.timezone} busy={decide.isPending} onDecide={(decision) => decide.mutate({ id: r.id, decision })} onEdit={() => setEditing(r)} />)}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tnum">Rows {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.total, meta.page * meta.pageSize)} of {meta.total}</span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /> Previous</Button>
            <Button size="sm" variant="secondary" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight /></Button>
          </span>
        </nav>
      )}

      <div className="sticky bottom-24 z-20 pt-2 md:bottom-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-[28px] border bg-card/95 px-5 py-3 shadow-xl backdrop-blur">
          <p className="text-sm tnum"><strong>{plural(toImport, 'transaction')}</strong> to import{s.pending > 0 && <span className="text-warn"> · {s.pending} undecided</span>}</p>
          <Button onClick={() => setConfirming(true)} disabled={toImport + s.pending === 0}>Review & import</Button>
        </div>
      </div>

      {editing && <RecordDialog job={job} record={editing} onClose={() => setEditing(null)} />}
      <Dialog open={confirming} onOpenChange={(o) => { setConfirming(o); if (!o) confirm.reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import {plural(toImport + (s.pending > 0 && pending === 'import' ? s.pending : 0), 'transaction')}?</DialogTitle>
            <DialogDescription>They are added to your ledger. You can undo this whole import afterwards from this page.</DialogDescription>
          </DialogHeader>
          {s.pending > 0 && (
            <fieldset className="space-y-2 rounded-2xl bg-warn-soft px-4 py-3">
              <legend className="text-[13px] font-medium text-warn">{plural(s.pending, 'possible duplicate')} still undecided</legend>
              <RadioGroup value={pending} onValueChange={(v) => setPending(v as 'skip' | 'import')} className="gap-2">
                <div className="flex items-center gap-2.5"><RadioGroupItem value="skip" id="pd-skip" /><Label htmlFor="pd-skip" className="text-sm font-normal">Skip them (safer)</Label></div>
                <div className="flex items-center gap-2.5"><RadioGroupItem value="import" id="pd-import" /><Label htmlFor="pd-import" className="text-sm font-normal">Import them anyway</Label></div>
              </RadioGroup>
            </fieldset>
          )}
          <div className="flex items-start gap-2.5">
            <Checkbox id="learn" checked={learn} onCheckedChange={(v) => setLearn(v === true)} className="mt-0.5" />
            <Label htmlFor="learn" className="text-[13px] leading-snug font-normal text-muted-foreground">Remember the platforms and categories I confirmed as rules, so the next import is quicker. You can review them under Platforms → Recognition rules.</Label>
          </div>
          {confirmError && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{confirmError}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Not yet</Button>
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>{confirm.isPending ? 'Starting…' : 'Import'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

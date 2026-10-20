import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { BadgeCheck, CircleHelp, Copy, FileUp, Link2, Pencil, Trash2, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  IMPORT_SOURCE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  rupeesToPaise,
  type TransactionDto,
  type TransactionSaveResult,
} from '@spendly/shared';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/field';
import { ConfidenceBadge, confidenceLevel } from '@/components/common/chips';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { Segmented } from '@/components/common/segmented';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { useIsDesktop } from '@/hooks/use-media-query';
import { ApiRequestError, api, apiUrl } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { TxnAmount } from './txn-row';

// ── context ────────────────────────────────────────────────────────────────────────────────────

interface PanelApi {
  openNew: (defaults?: Partial<FormValues>) => void;
  openView: (id: string) => void;
}
const PanelContext = createContext<PanelApi | null>(null);
export const useTransactionPanel = () => {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('useTransactionPanel must be used inside TransactionPanelProvider');
  return ctx;
};

type Target = { kind: 'new'; defaults?: Partial<FormValues> } | { kind: 'view'; id: string };

export function TransactionPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const api_ = useMemo<PanelApi>(
    () => ({
      openNew: (defaults) => {
        setTarget({ kind: 'new', defaults });
        setOpen(true);
      },
      openView: (id) => {
        setTarget({ kind: 'view', id });
        setOpen(true);
      },
    }),
    [],
  );
  const close = useCallback(() => setOpen(false), []);
  const body = target ? <PanelBody key={target.kind === 'view' ? target.id : 'new'} target={target} onClose={close} /> : null;

  return (
    <PanelContext.Provider value={api_}>
      {children}
      {desktop ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto rounded-l-[28px] border-l p-0 sm:max-w-[30rem]">
            <SheetTitle className="sr-only">Transaction</SheetTitle>
            <SheetDescription className="sr-only">Transaction details and editing</SheetDescription>
            {body}
          </SheetContent>
        </Sheet>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[92dvh]">
            <DrawerTitle className="sr-only">Transaction</DrawerTitle>
            <DrawerDescription className="sr-only">Transaction details and editing</DrawerDescription>
            <div className="overflow-y-auto">{body}</div>
          </DrawerContent>
        </Drawer>
      )}
    </PanelContext.Provider>
  );
}

// ── body ───────────────────────────────────────────────────────────────────────────────────────

function PanelBody({ target, onClose }: { target: Target; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const id = target.kind === 'view' ? target.id : null;
  const q = useQuery({ queryKey: ['transactions', 'one', id], queryFn: () => api.get<TransactionDto>(`/transactions/${id}`), enabled: Boolean(id) });

  if (target.kind === 'new') {
    return (
      <div className="px-5 pt-6 pb-8 sm:px-7">
        <h2 className="text-xl font-semibold tracking-tight">Add a transaction</h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">Leave platform and category on auto-detect and Spendly will work them out from the merchant.</p>
        <TransactionForm defaults={target.defaults} onDone={onClose} />
      </div>
    );
  }
  if (q.isPending) return <div className="space-y-4 p-6"><Skeleton className="h-14 w-full rounded-2xl" /><Skeleton className="h-40 w-full rounded-3xl" /></div>;
  if (q.isError) return <div className="p-8 text-center text-sm text-muted-foreground">{q.error instanceof ApiRequestError ? q.error.message : 'Could not load this transaction.'}</div>;
  const t = q.data;
  return editing ? (
    <div className="px-5 pt-6 pb-8 sm:px-7">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">Edit transaction</h2>
      <TransactionForm transaction={t} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
    </div>
  ) : (
    <TransactionView t={t} onEdit={() => setEditing(true)} onClose={onClose} />
  );
}

// ── detail view ────────────────────────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-4 py-3">
      <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function TransactionView({ t, onEdit, onClose }: { t: TransactionDto; onEdit: () => void; onClose: () => void }) {
  const { prefs } = useSession();
  const cat = useCatalog();
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const platform = cat.platform(t.platform);
  const category = cat.category(t.category);

  const del = useMutation({
    mutationFn: () => api.delete(`/transactions/${t.id}`),
    onSuccess: () => {
      toast.success('Transaction deleted');
      void invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete'),
  });
  const confirmClass = useMutation({
    mutationFn: () => api.post('/transactions/bulk', { action: 'confirm_classification', ids: [t.id] }),
    onSuccess: () => {
      toast.success('Marked as reviewed');
      void invalidate();
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append('file', file);
      return api.upload<TransactionDto>(`/transactions/${t.id}/receipt`, f);
    },
    onSuccess: (data) => {
      qc.setQueryData(['transactions', 'one', t.id], data);
      toast.success('Receipt attached');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });
  const removeReceipt = useMutation({
    mutationFn: () => api.delete(`/transactions/${t.id}/receipt`),
    onSuccess: () => {
      qc.setQueryData<TransactionDto>(['transactions', 'one', t.id], (old) => (old ? { ...old, receipt: null } : old));
      toast.success('Receipt removed');
    },
  });

  return (
    <div className="pb-8">
      <div className="px-5 pt-6 sm:px-7">
        <div className="flex items-start gap-3">
          {platform ? <PlatformLogo platform={platform} size={52} /> : <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={52} />}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate text-lg leading-tight font-semibold tracking-tight">{t.merchantName}</h2>
            <p className="text-[13px] text-muted-foreground">
              {formatDate(t.date, prefs.timezone, 'long')}
              {t.hasTime && <> · {formatTime(t.date, prefs.timezone)}</>}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <TxnAmount t={t} size="lg" className="text-[34px]" />
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{TRANSACTION_TYPE_LABELS[t.type]}</Badge>
            {t.status !== 'completed' && <Badge variant="warn">{t.status}</Badge>}
            {t.isDemo && <Badge variant="warn">Demo</Badge>}
          </div>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2.5 px-5 sm:px-7">
        <Fact label="Category">
          {t.categoryName ?? 'Uncategorized'}
          {t.subcategory && <span className="text-muted-foreground"> · {t.subcategory}</span>}
        </Fact>
        <Fact label="Platform">{t.platformName ?? 'Other / unassigned'}</Fact>
        <Fact label="Paid with">{PAYMENT_METHOD_LABELS[t.paymentMethod]}</Fact>
        <Fact label="Source">{IMPORT_SOURCE_LABELS[t.importSource]}</Fact>
        {t.externalRef && <Fact label="Reference"><span className="tnum break-all">{t.externalRef}</span></Fact>}
        {t.tags.length > 0 && (
          <Fact label="Tags">
            <span className="flex flex-wrap gap-1">
              {t.tags.map((x) => (
                <Badge key={x}>{x}</Badge>
              ))}
            </span>
          </Fact>
        )}
        {t.description && <div className="col-span-2"><Fact label="Description"><span className="break-words">{t.description}</span></Fact></div>}
        {t.notes && <div className="col-span-2"><Fact label="Notes"><span className="break-words whitespace-pre-wrap">{t.notes}</span></Fact></div>}
      </dl>

      <section aria-label="How this was classified" className="mx-5 mt-4 rounded-3xl border p-4 sm:mx-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">How it was classified</p>
          {t.classification.confidence > 0 ? <ConfidenceBadge level={confidenceLevel(t.classification.confidence)} score={t.classification.confidence} /> : <Badge variant="bad">Not classified</Badge>}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{t.classification.reason || 'No reason recorded.'}</p>
        {t.classification.needsReview && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="warn"><CircleHelp aria-hidden /> Needs your review</Badge>
            <Button size="xs" variant="secondary" onClick={() => confirmClass.mutate()} disabled={confirmClass.isPending}><BadgeCheck /> This is correct</Button>
            <Button size="xs" variant="outline" onClick={onEdit}>Change it</Button>
          </div>
        )}
      </section>

      {(t.refundOfId || t.duplicateStatus === 'possible') && (
        <div className="mx-5 mt-3 space-y-2 sm:mx-7">
          {t.refundOfId && <p className="flex items-center gap-2 rounded-2xl bg-ok-soft px-4 py-3 text-[13px] text-ok"><Link2 className="size-4 shrink-0" aria-hidden /> Linked to the purchase it refunds, so it reduces net spending instead of counting as income.</p>}
          {t.duplicateStatus === 'possible' && <p className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn"><Copy className="size-4 shrink-0" aria-hidden /> This may duplicate another transaction. Review it under Transactions → Duplicates.</p>}
        </div>
      )}

      <section aria-label="Receipt" className="mx-5 mt-4 rounded-3xl border p-4 sm:mx-7">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Receipt</p>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <Button size="xs" variant="secondary" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><FileUp /> {t.receipt ? 'Replace' : 'Attach'}</Button>
        </div>
        {t.receipt ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-3 py-2.5 text-sm">
            <a href={apiUrl(`/transactions/${t.id}/receipt`)} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate underline-offset-4 hover:underline">{t.receipt.filename}</a>
            <Button size="icon-xs" variant="ghost" onClick={() => removeReceipt.mutate()} aria-label="Remove receipt"><X /></Button>
          </div>
        ) : <p className="mt-1 text-[13px] text-muted-foreground">PNG, JPEG, WebP or PDF up to 8 MB. Stored privately — only you can open it.</p>}
      </section>

      <div className="mt-6 flex gap-2 px-5 sm:px-7">
        <Button className="flex-1" onClick={onEdit}><Pencil /> Edit</Button>
        <Button variant="secondary" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this transaction?" description={<>This removes <strong>{t.merchantName}</strong> (<Money paise={t.amountPaise} size="inherit" />) from your records and totals. Any refund linked to it is kept.</>} confirmLabel="Delete" destructive pending={del.isPending} onConfirm={() => del.mutate()} />
    </div>
  );
}

// ── form ───────────────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: z.string().trim().refine((v) => {
    try {
      return rupeesToPaise(v) > 0;
    } catch {
      return false;
    }
  }, 'Enter an amount like 249 or 1,249.50'),
  merchantName: z.string().trim().min(1, 'Enter a merchant').max(120),
  date: z.string().min(1, 'Choose a date and time'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  status: z.enum(TRANSACTION_STATUSES),
  platform: z.string(),
  category: z.string(),
  subcategory: z.string().max(80),
  description: z.string().max(500),
  notes: z.string().max(2000),
  tags: z.string().max(300),
  externalRef: z.string().max(80),
});
type FormValues = z.infer<typeof schema>;

const LOCAL = "yyyy-LL-dd'T'HH:mm";
const AUTO = 'auto';

function TransactionForm({ transaction: t, defaults, onDone, onCancel }: { transaction?: TransactionDto; defaults?: Partial<FormValues>; onDone: () => void; onCancel?: () => void }) {
  const { prefs } = useSession();
  const cat = useCatalog();
  const invalidate = useInvalidateMoney();
  const tz = prefs.timezone;
  const nowLocal = DateTime.now().setZone(tz).toFormat(LOCAL);

  const initial: FormValues = {
    type: t?.type ?? 'expense',
    amount: t ? String(t.amountPaise / 100) : '',
    merchantName: t?.merchantName ?? '',
    date: t ? DateTime.fromISO(t.date, { zone: tz }).toFormat(LOCAL) : nowLocal,
    paymentMethod: t?.paymentMethod ?? 'upi',
    status: t?.status ?? 'completed',
    platform: t?.platform ?? AUTO,
    category: t?.category ?? AUTO,
    subcategory: t?.subcategory ?? '',
    description: t?.description ?? '',
    notes: t?.notes ?? '',
    tags: t?.tags.join(', ') ?? '',
    externalRef: t?.externalRef ?? '',
    ...defaults,
  };
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initial });
  const { register, handleSubmit, control, watch, formState: { errors } } = form;
  const merchant = watch('merchantName');
  const type = watch('type');

  // live hint: what the recognition engine makes of the merchant (debounced)
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMerchantInput = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(v.trim()), 450);
  };
  const preview = useQuery({
    queryKey: ['rules', 'preview', debounced, type],
    enabled: debounced.length >= 3 && !t,
    queryFn: () => api.post<{ platform: string | null; platformName: string | null; categoryName: string | null; confidence: number; reason: string }>('/rules/preview', { merchant: debounced, direction: type === 'income' || type === 'refund' ? 'credit' : 'debit' }),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const date = DateTime.fromFormat(v.date, LOCAL, { zone: tz });
      if (!date.isValid) throw new Error('Choose a valid date and time');
      const payload: Record<string, unknown> = {
        merchantName: v.merchantName,
        amountPaise: rupeesToPaise(v.amount),
        date: date.toUTC().toISO(),
        type: v.type,
        status: v.status,
        paymentMethod: v.paymentMethod,
        description: v.description,
        notes: v.notes,
        tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10),
        externalRef: v.externalRef.trim() || null,
        subcategory: v.subcategory.trim() || null,
      };
      if (!t || v.date !== initial.date) payload.hasTime = true;
      if (v.platform !== AUTO && v.platform !== (t?.platform ?? AUTO)) payload.platform = v.platform === 'none' ? null : v.platform;
      if (v.category !== AUTO && v.category !== (t?.category ?? AUTO)) payload.category = v.category === 'none' ? null : v.category;
      return t ? api.patch<TransactionSaveResult & { similarCount?: number }>(`/transactions/${t.id}`, payload) : api.post<{ transaction: TransactionDto; warnings: string[] }>('/transactions', payload);
    },
    onSuccess: (res, v) => {
      void invalidate();
      if ('warnings' in res) {
        toast.success('Transaction added');
        res.warnings.forEach((w) => toast.warning(w, { duration: 8000 }));
      } else {
        toast.success('Changes saved');
        const learn = res as TransactionSaveResult;
        if (learn.suggestRule && (v.platform !== AUTO || v.category !== AUTO)) {
          const id = t?.id;
          toast(`Remember this for ${learn.suggestRule.pattern}?`, {
            description: learn.similarCount ? `Also fixes ${learn.similarCount} similar transaction${learn.similarCount === 1 ? '' : 's'}.` : 'Future transactions will match automatically.',
            duration: 12000,
            action: {
              label: 'Remember',
              onClick: () =>
                void api
                  .patch(`/transactions/${id}`, { platform: v.platform !== AUTO ? (v.platform === 'none' ? null : v.platform) : undefined, category: v.category !== AUTO ? (v.category === 'none' ? null : v.category) : undefined, learn: { createRule: true, applyToSimilar: true } })
                  .then(() => { toast.success('Rule saved'); void invalidate(); }),
            },
          });
        }
      }
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });

  const err = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  const platformGroups = useMemo(() => {
    const m = new Map<string, typeof cat.platforms>();
    for (const p of cat.platforms) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the list is derived from cat.platforms only
  }, [cat.platforms]);

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Controller control={control} name="type" render={({ field }) => (
        <Segmented label="Transaction type" value={field.value} onChange={field.onChange} options={TRANSACTION_TYPES.map((x) => ({ value: x, label: TRANSACTION_TYPE_LABELS[x] }))} size="sm" className="w-full justify-between *:flex-1" />
      )} />

      <div className="grid grid-cols-[1fr] gap-4 sm:grid-cols-2">
        <Field label="Amount (₹)" error={err('amount')}>
          <Input inputMode="decimal" autoComplete="off" placeholder="0.00" aria-invalid={Boolean(errors.amount)} {...register('amount')} className="text-lg font-semibold tabular-nums" />
        </Field>
        <Field label="Date & time" error={err('date')}>
          <Input type="datetime-local" max={DateTime.now().setZone(tz).plus({ days: 1 }).toFormat(LOCAL)} aria-invalid={Boolean(errors.date)} {...register('date')} />
        </Field>
      </div>

      <Field label="Merchant" error={err('merchantName')} hint={!t && preview.data?.platformName ? `Looks like ${preview.data.platformName}${preview.data.categoryName ? ` · ${preview.data.categoryName}` : ''} (${Math.round(preview.data.confidence * 100)}% sure)` : undefined}>
        <Input placeholder="e.g. Zomato, Third Wave Coffee" autoComplete="off" aria-invalid={Boolean(errors.merchantName)} {...register('merchantName', { onChange: (e) => onMerchantInput(e.target.value) })} />
      </Field>
      {!t && merchant.trim().length >= 3 && !preview.data?.platformName && preview.data && <p className="-mt-2 px-1 text-xs text-muted-foreground">{preview.data.reason}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform">
          <Controller control={control} name="platform" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={AUTO}>{t ? 'Keep as is' : 'Auto-detect'}</SelectItem>
                <SelectItem value="none">Other / unassigned</SelectItem>
                {platformGroups.map(([g, list]) => (
                  <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>{list.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>)}</SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )} />
        </Field>
        <Field label="Category">
          <Controller control={control} name="category" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={AUTO}>{t ? 'Keep as is' : 'Auto-detect'}</SelectItem>
                {cat.categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment method">
          <Controller control={control} name="paymentMethod" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </Field>
        <Field label="Status">
          <Controller control={control} name="status" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TRANSACTION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        </Field>
      </div>

      <details className="rounded-2xl border px-4 py-3 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">More details</summary>
        <div className="space-y-4">
          <Field label="Subcategory"><Input placeholder="e.g. Late-night orders" {...register('subcategory')} /></Field>
          <Field label="Description"><Input placeholder="Bank narration or what it was for" {...register('description')} /></Field>
          <Field label="Tags" hint="Separate with commas"><Input placeholder="trip, office" {...register('tags')} /></Field>
          <Field label="Reference number"><Input placeholder="UPI / order reference" {...register('externalRef')} /></Field>
          <Field label="Notes"><Textarea placeholder="Anything worth remembering" {...register('notes')} /></Field>
        </div>
      </details>

      <div className="flex gap-2 pt-1">
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="flex-1" disabled={save.isPending}>{save.isPending ? 'Saving…' : t ? 'Save changes' : 'Add transaction'}</Button>
      </div>
    </form>
  );
}

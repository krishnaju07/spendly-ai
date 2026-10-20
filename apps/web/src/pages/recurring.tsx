import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, ChevronDown, CircleAlert, Pencil, RefreshCw, Repeat, TrendingUp, Undo2, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { rupeesToPaise, type RecurringDto, type RecurringSummaryDto } from '@spendly/shared';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { ConfidenceBadge, StatementBadge } from '@/components/common/chips';
import { Field } from '@/components/common/field';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, PageHeader, SectionTitle } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { ApiRequestError, api } from '@/lib/api';
import { formatDate, inrRound, plural, relativeDays } from '@/lib/format';
import { cn } from '@/lib/utils';

type Status = RecurringDto['status'];

const schema = z.object({
  amount: z.string().refine((v) => {
    if (!v.trim()) return true;
    try {
      return rupeesToPaise(v) > 0;
    } catch {
      return false;
    }
  }, 'Enter an amount above zero, or leave it empty'),
  nextDate: z.string(),
  reminder: z.string(),
});
type Values = z.infer<typeof schema>;

function AdjustDialog({ item, onClose }: { item: RecurringDto; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', nextDate: item.nextExpectedDate?.slice(0, 10) ?? '', reminder: String(item.reminderDaysBefore) },
  });
  const save = useMutation({
    mutationFn: (v: Values) =>
      api.patch<RecurringDto>(`/recurring-payments/${item.id}`, {
        ...(v.amount.trim() ? { amountPaise: rupeesToPaise(v.amount) } : {}),
        ...(v.nextDate ? { nextExpectedDate: v.nextDate } : {}),
        reminderDaysBefore: Number(v.reminder),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Saved');
      onClose();
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save.' : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {item.displayName}</DialogTitle>
          <DialogDescription>Correct what Spendly guessed. Your changes only affect reminders and estimates, never your recorded transactions.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Usual amount (₹)" hint={`Currently ${inrRound(item.amountPaise)}. Leave empty to keep it.`} error={errors.amount?.message} htmlFor="r-amount">
            <Input id="r-amount" inputMode="decimal" placeholder={String(item.amountPaise / 100)} {...register('amount')} aria-invalid={Boolean(errors.amount)} />
          </Field>
          <Field label="Next payment" htmlFor="r-next"><Input id="r-next" type="date" {...register('nextDate')} /></Field>
          <Field label="Remind me">
            <Select value={watch('reminder')} onValueChange={(v) => setValue('reminder', v)}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">On the day</SelectItem>
                {[1, 2, 3, 5, 7, 14].map((d) => <SelectItem key={d} value={String(d)}>{d} day{d === 1 ? '' : 's'} before</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ r, tz, onStatus, onAdjust, busy }: { r: RecurringDto; tz: string; onStatus: (s: Status) => void; onAdjust: () => void; busy: boolean }) {
  const cat = useCatalog();
  const [why, setWhy] = useState(false);
  const platform = cat.platform(r.platform);
  const category = cat.category(r.category);
  const last = r.priceChanges[r.priceChanges.length - 1];
  const cadence = ({ weekly: 'week', biweekly: '2 weeks', monthly: 'month', quarterly: 'quarter', half_yearly: '6 months', yearly: 'year' } as Record<string, string>)[r.frequency] ?? r.frequencyLabel.toLowerCase();
  return (
    <li className="rounded-3xl border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {platform ? <PlatformLogo platform={platform} size={46} /> : <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={46} />}
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{r.displayName}</span>
            {r.possiblyInactive && <Badge variant="warn"><CircleAlert aria-hidden /> May have stopped</Badge>}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {r.frequencyLabel} · {plural(r.occurrences, 'payment')} since {formatDate(r.firstDate, tz, 'long')}
          </p>
          {r.nextExpectedDate && r.status !== 'dismissed' && (
            <p className="mt-1 text-[13px]">
              Next around <span className="font-medium">{formatDate(r.nextExpectedDate, tz, 'long')}</span>
              {r.daysUntilNext !== null && <span className="text-muted-foreground"> ({relativeDays(r.daysUntilNext)})</span>}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-1">
            {r.amountVariable && <span className="text-sm text-muted-foreground">~</span>}
            <Money paise={r.amountPaise} size="lg" />
            <span className="text-xs text-muted-foreground">/{cadence}</span>
          </div>
          {r.amountVariable ? <p className="mt-1 text-xs text-muted-foreground tnum">varies {inrRound(r.amountMinPaise)}–{inrRound(r.amountMaxPaise)}</p> : null}
          <p className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground tnum">
            {r.frequency !== 'monthly' && <>≈ {inrRound(r.monthlyCostPaise)}/mo · </>}{inrRound(r.annualCostPaise)}/yr
            {r.amountVariable && <StatementBadge kind="estimate" />}
          </p>
        </div>
      </div>

      {last && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-warn-soft px-3.5 py-2 text-[13px] text-warn">
          <TrendingUp className="size-4" aria-hidden />
          Price changed from {inrRound(last.fromPaise)} to {inrRound(last.toPaise)} on {formatDate(last.date, tz, 'long')}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ConfidenceBadge level={r.confidenceLabel} score={r.confidence} />
        <Button size="xs" variant="ghost" className="text-muted-foreground" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          Why Spendly thinks so <ChevronDown className={cn('transition-transform', why && 'rotate-180')} />
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {r.status === 'detected' && (
            <>
              <Button size="sm" onClick={() => onStatus('confirmed')} disabled={busy}><Check /> Yes, recurring</Button>
              <Button size="sm" variant="secondary" onClick={() => onStatus('dismissed')} disabled={busy}><X /> Not recurring</Button>
            </>
          )}
          {r.status === 'confirmed' && (
            <>
              <Button size="sm" variant="secondary" onClick={onAdjust}><Pencil /> Adjust</Button>
              <Button size="sm" variant="ghost" onClick={() => onStatus('dismissed')} disabled={busy}>Stop tracking</Button>
            </>
          )}
          {r.status === 'dismissed' && <Button size="sm" variant="secondary" onClick={() => onStatus('detected')} disabled={busy}><Undo2 /> Restore</Button>}
        </div>
      </div>
      {why && (
        <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-muted/60 py-3 pr-4 pl-8 text-[13px] text-muted-foreground">
          {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
    </li>
  );
}

export default function Recurring() {
  const { prefs } = useSession();
  const tz = prefs.timezone;
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const [tab, setTab] = useState<Status | null>(null);
  const [adjusting, setAdjusting] = useState<RecurringDto | null>(null);

  const q = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<RecurringSummaryDto>('/recurring-payments') });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => api.patch<RecurringDto>(`/recurring-payments/${id}`, { status }),
    onSuccess: async (_d, v) => {
      await invalidate();
      toast.success(v.status === 'confirmed' ? 'Marked as recurring — you will get reminders' : v.status === 'dismissed' ? 'Removed from your recurring payments' : 'Moved back to review');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update that payment'),
  });
  const rescan = useMutation({
    mutationFn: () => api.post<RecurringSummaryDto & { found: number }>('/recurring-payments/detect'),
    onSuccess: (d) => {
      qc.setQueryData(['recurring'], { items: d.items, totals: d.totals, lastDetectedAt: d.lastDetectedAt });
      toast.success(d.found ? `Found ${plural(d.found, 'repeating payment')}` : 'No new repeating payments found');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not scan'),
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const by = useMemo(() => ({ detected: items.filter((i) => i.status === 'detected'), confirmed: items.filter((i) => i.status === 'confirmed'), dismissed: items.filter((i) => i.status === 'dismissed') }), [items]);
  const current: Status = tab ?? (by.detected.length ? 'detected' : 'confirmed');
  const upcoming = by.confirmed.filter((i) => i.daysUntilNext !== null && i.daysUntilNext >= 0 && i.daysUntilNext <= 30).sort((a, b) => (a.daysUntilNext ?? 0) - (b.daysUntilNext ?? 0)).slice(0, 5);
  const t = q.data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring Payments"
        subtitle="Subscriptions, rent and bills that repeat. Spendly spots them from your history — that is an estimate, so confirm the ones you recognise."
        actions={<Button size="sm" variant="secondary" onClick={() => rescan.mutate()} disabled={rescan.isPending}><RefreshCw className={rescan.isPending ? 'animate-spin' : undefined} /> Scan again</Button>}
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isPending ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-3xl" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState className="rounded-[32px] border bg-card" icon={Repeat} title="No repeating payments found" description="Spendly looks for payments to the same merchant at regular intervals. Import a few months of statements and scan again." action={{ label: 'Import a statement', to: '/import' }} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Totals">
            <div className="col-span-2 rounded-[28px] bg-tile p-5 lg:col-span-1">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Confirmed · per month</p>
              <div className="mt-2"><Money paise={t?.confirmedMonthlyPaise ?? 0} size="xl" /></div>
              <p className="mt-2 text-xs text-muted-foreground tnum">{inrRound(t?.confirmedAnnualPaise ?? 0)} a year across {plural(t?.confirmedCount ?? 0, 'payment')}</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">To review <StatementBadge kind="estimate" /></p>
              <div className="mt-2"><Money paise={t?.detectedMonthlyPaise ?? 0} size="lg" /></div>
              <p className="mt-2 text-xs text-muted-foreground">per month if all {plural(t?.detectedCount ?? 0, 'payment')} are real</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Last scan</p>
              <p className="mt-2 text-lg font-semibold tracking-tight">{q.data?.lastDetectedAt ? formatDate(q.data.lastDetectedAt, tz, 'long') : 'Not yet'}</p>
              <p className="mt-2 text-xs text-muted-foreground">Runs again whenever you press “Scan again”.</p>
            </div>
          </section>

          {upcoming.length > 0 && (
            <Card aria-label="Coming up" className="gap-3">
              <SectionTitle>Coming up in the next 30 days</SectionTitle>
              <ul className="divide-y">
                {upcoming.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{u.displayName}</span>
                    <span className="text-muted-foreground">{u.nextExpectedDate ? formatDate(u.nextExpectedDate, tz) : ''} · {relativeDays(u.daysUntilNext)}</span>
                    <Money paise={u.amountPaise} size="md" />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Tabs value={current} onValueChange={(v) => setTab(v as Status)}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList aria-label="Recurring payment status" className="w-max">
                <TabsTrigger value="detected">To review ({by.detected.length})</TabsTrigger>
                <TabsTrigger value="confirmed">Confirmed ({by.confirmed.length})</TabsTrigger>
                <TabsTrigger value="dismissed">Dismissed ({by.dismissed.length})</TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          {by[current].length === 0 ? (
            <EmptyState compact className="rounded-3xl border bg-card" icon={Repeat} title={current === 'detected' ? 'Nothing waiting for review' : current === 'confirmed' ? 'No confirmed payments yet' : 'Nothing dismissed'} description={current === 'confirmed' ? 'Confirm detected payments to get reminders and see your fixed monthly costs.' : undefined} />
          ) : (
            <ul className="stagger space-y-3">
              {by[current].map((r) => <Row key={r.id} r={r} tz={tz} busy={setStatus.isPending} onStatus={(status) => setStatus.mutate({ id: r.id, status })} onAdjust={() => setAdjusting(r)} />)}
            </ul>
          )}
        </>
      )}
      {adjusting && <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

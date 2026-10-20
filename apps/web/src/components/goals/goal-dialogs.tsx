import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { GOAL_TYPES, rupeesToPaise, type GoalDto, type GoalScenarioDto } from '@spendly/shared';
import { StatementBadge } from '@/components/common/chips';
import { Field } from '@/components/common/field';
import { Money } from '@/components/common/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/use-auth';
import { useCatalog } from '@/hooks/use-catalog';
import { ApiRequestError, api } from '@/lib/api';
import { formatDate, inrRound } from '@/lib/format';

export const GOAL_TYPE_LABEL: Record<(typeof GOAL_TYPES)[number], string> = {
  emergency: 'Emergency fund',
  laptop: 'Laptop or gadget',
  travel: 'Travel',
  vehicle: 'Vehicle',
  education: 'Education',
  personal: 'Personal',
  custom: 'Something else',
};

const amount = (required: boolean) =>
  z.string().refine((v) => {
    if (!v.trim()) return !required;
    try {
      return rupeesToPaise(v) > 0 || !required;
    } catch {
      return false;
    }
  }, required ? 'Enter an amount above zero' : 'Enter a valid amount, or leave it empty');

const goalSchema = z.object({
  name: z.string().trim().min(1, 'Name your goal').max(80),
  type: z.enum(GOAL_TYPES),
  target: amount(true),
  saved: amount(false),
  targetDate: z.string().min(1, 'Choose a target date'),
  notes: z.string().max(500),
});
type GoalValues = z.infer<typeof goalSchema>;

export function GoalDialog({ goal, onClose, onSaved }: { goal?: GoalDto; onClose: () => void; onSaved: () => void }) {
  const { prefs } = useSession();
  const today = DateTime.now().setZone(prefs.timezone).toISODate() ?? '';
  const { register, handleSubmit, control, formState: { errors } } = useForm<GoalValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: goal?.name ?? '',
      type: (goal?.type as GoalValues['type']) ?? 'custom',
      target: goal ? String(goal.targetAmountPaise / 100) : '',
      saved: goal ? String(goal.savedAmountPaise / 100) : '',
      targetDate: goal?.targetDate.slice(0, 10) ?? '',
      notes: goal?.notes ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: GoalValues) => {
      const body = { name: v.name, type: v.type, targetAmountPaise: rupeesToPaise(v.target), savedAmountPaise: v.saved.trim() ? rupeesToPaise(v.saved) : 0, targetDate: v.targetDate, notes: v.notes };
      return goal ? api.patch<GoalDto>(`/savings-goals/${goal.id}`, body) : api.post<GoalDto>('/savings-goals', body);
    },
    onSuccess: () => {
      toast.success(goal ? 'Goal updated' : 'Goal created');
      onSaved();
      onClose();
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save the goal.' : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New savings goal'}</DialogTitle>
          <DialogDescription>A goal is a tracker. Spendly records what you tell it you have saved — it never moves or holds any money.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Name" error={errors.name?.message} htmlFor="g-name"><Input id="g-name" autoFocus placeholder="e.g. New laptop" {...register('name')} aria-invalid={Boolean(errors.name)} /></Field>
          <Field label="Kind">
            <Controller control={control} name="type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>{GOAL_TYPES.map((t) => <SelectItem key={t} value={t}>{GOAL_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target (₹)" error={errors.target?.message} htmlFor="g-target"><Input id="g-target" inputMode="decimal" placeholder="80,000" {...register('target')} aria-invalid={Boolean(errors.target)} /></Field>
            <Field label="Saved so far (₹)" error={errors.saved?.message} htmlFor="g-saved"><Input id="g-saved" inputMode="decimal" placeholder="0" {...register('saved')} aria-invalid={Boolean(errors.saved)} /></Field>
          </div>
          <Field label="Target date" error={errors.targetDate?.message} htmlFor="g-date"><Input id="g-date" type="date" min={goal ? undefined : today} {...register('targetDate')} aria-invalid={Boolean(errors.targetDate)} /></Field>
          <Field label="Notes (optional)" htmlFor="g-notes"><Textarea id="g-notes" rows={2} {...register('notes')} /></Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : goal ? 'Save changes' : 'Create goal'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const contributionSchema = z.object({ amount: amount(true), date: z.string().min(1, 'Choose a date'), note: z.string().max(200) });
type ContributionValues = z.infer<typeof contributionSchema>;

export function ContributionDialog({ goal, onClose, onSaved }: { goal: GoalDto; onClose: () => void; onSaved: () => void }) {
  const { prefs } = useSession();
  const today = DateTime.now().setZone(prefs.timezone).toISODate() ?? '';
  const { register, handleSubmit, formState: { errors } } = useForm<ContributionValues>({ resolver: zodResolver(contributionSchema), defaultValues: { amount: '', date: today, note: '' } });
  const save = useMutation({
    mutationFn: (v: ContributionValues) => api.post<GoalDto>(`/savings-goals/${goal.id}/contributions`, { amountPaise: rupeesToPaise(v.amount), date: v.date, note: v.note }),
    onSuccess: () => {
      toast.success('Saved towards your goal');
      onSaved();
      onClose();
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save.' : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to {goal.name}</DialogTitle>
          <DialogDescription>Record money you have set aside yourself. This only updates the tracker; no money moves.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Amount (₹)" error={errors.amount?.message} htmlFor="c-amount"><Input id="c-amount" autoFocus inputMode="decimal" {...register('amount')} aria-invalid={Boolean(errors.amount)} /></Field>
          <Field label="Date" error={errors.date?.message} htmlFor="c-date"><Input id="c-date" type="date" max={today} {...register('date')} /></Field>
          <Field label="Note (optional)" htmlFor="c-note"><Input id="c-note" maxLength={200} {...register('note')} /></Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "What if I spent less on X?" — an estimate from the user's own recent spending, clearly labelled. */
export function ScenarioDialog({ goal, onClose }: { goal: GoalDto; onClose: () => void }) {
  const { prefs } = useSession();
  const tz = prefs.timezone;
  const cat = useCatalog();
  const [category, setCategory] = useState(cat.spendingCategories.find((c) => c.discretionary)?.slug ?? cat.spendingCategories[0]?.slug ?? '');
  const [pct, setPct] = useState(20);
  const [debounced, setDebounced] = useState(pct);
  const [planned, setPlanned] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(pct), 250);
    return () => clearTimeout(t);
  }, [pct]);
  let plannedOk: string | undefined;
  try {
    plannedOk = planned.trim() ? String(rupeesToPaise(planned) / 100) : undefined;
  } catch {
    plannedOk = undefined;
  }
  const q = useQuery({
    queryKey: ['goals', 'scenario', goal.id, category, debounced, plannedOk],
    queryFn: () => api.get<GoalScenarioDto>(`/savings-goals/${goal.id}/scenario`, { category, reducePct: debounced, plannedMonthly: plannedOk }),
    enabled: Boolean(category),
    placeholderData: keepPreviousData,
  });
  const s = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What if I spent less?</DialogTitle>
          <DialogDescription>See how trimming one category could change when you reach “{goal.name}”.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Category to trim">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">{cat.spendingCategories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={`Spend ${pct}% less`} htmlFor="sc-pct">
            <input id="sc-pct" type="range" min={5} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="h-11 w-full accent-[var(--series-1)]" aria-valuetext={`${pct} percent less`} />
          </Field>
          <Field label="Or set aside a fixed amount each month (₹, optional)" htmlFor="sc-plan" hint="If you already plan to save a set amount, add it here and the estimate includes it.">
            <Input id="sc-plan" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder="0" />
          </Field>

          <div aria-live="polite" className="rounded-3xl bg-muted/60 p-5">
            {q.isPending ? <Skeleton className="h-24" /> : q.isError ? <p className="text-sm text-bad">{q.error instanceof Error ? q.error.message : 'Could not work that out.'}</p> : s ? (
              <div className={q.isFetching ? 'opacity-60' : undefined}>
                <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Estimated result <StatementBadge kind="estimate" /></p>
                <p className="mt-3 text-sm">
                  You spend about <strong className="tnum">{inrRound(s.currentMonthlyPaise)}</strong> a month on {s.categoryName}. Cutting {s.reducePct}% would free about
                </p>
                <div className="mt-1"><Money paise={s.monthlySavingPaise} size="xl" /> <span className="text-sm text-muted-foreground">a month</span></div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-card px-4 py-3">
                    <dt className="text-xs text-muted-foreground">As things are</dt>
                    <dd className="mt-1 font-medium tnum">{s.monthsToGoalBaseline === null ? 'No pace to project' : `${s.monthsToGoalBaseline} month${s.monthsToGoalBaseline === 1 ? '' : 's'}`}</dd>
                    {s.finishBaseline && <dd className="text-xs text-muted-foreground">{formatDate(s.finishBaseline, tz, 'long')}</dd>}
                  </div>
                  <div className="rounded-2xl bg-card px-4 py-3">
                    <dt className="text-xs text-muted-foreground">With this change</dt>
                    <dd className="mt-1 font-medium tnum">{s.monthsToGoalScenario === null ? 'No pace to project' : `${s.monthsToGoalScenario} month${s.monthsToGoalScenario === 1 ? '' : 's'}`}</dd>
                    {s.finishScenario && <dd className="text-xs text-muted-foreground">{formatDate(s.finishScenario, tz, 'long')}</dd>}
                  </div>
                </dl>
                {s.monthsSaved !== null && s.monthsSaved > 0 && <p className="mt-3 text-sm font-medium">About {s.monthsSaved} month{s.monthsSaved === 1 ? '' : 's'} sooner.</p>}
                {s.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

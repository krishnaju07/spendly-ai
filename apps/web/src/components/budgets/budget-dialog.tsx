import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { rupeesToPaise, type BudgetDto } from '@spendly/shared';
import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { ApiRequestError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

const THRESHOLDS = [50, 70, 80, 90, 100] as const;

const validAmount = (v: string) => {
  try {
    return rupeesToPaise(v) > 0;
  } catch {
    return false;
  }
};

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give the budget a name').max(80),
    scope: z.enum(['overall', 'category', 'platform']),
    category: z.string(),
    platform: z.string(),
    period: z.enum(['monthly', 'weekly', 'custom']),
    startDate: z.string(),
    endDate: z.string(),
    amount: z.string().refine(validAmount, 'Enter an amount above zero'),
    thresholds: z.array(z.number()).min(1, 'Pick at least one alert level'),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'category' && v.category === 'none') ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose a category' });
    if (v.scope === 'platform' && v.platform === 'none') ctx.addIssue({ code: 'custom', path: ['platform'], message: 'Choose a platform' });
    if (v.period === 'custom') {
      if (!v.startDate || !v.endDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Choose a start and end date' });
      else if (v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end date is before the start date' });
    }
  });
type Values = z.infer<typeof schema>;

/** Create or edit a budget. Amounts are typed in rupees and sent as paise. */
export function BudgetDialog({ open, onOpenChange, budget, preset }: { open: boolean; onOpenChange: (o: boolean) => void; budget?: BudgetDto; preset?: Partial<Pick<Values, 'name' | 'scope' | 'category' | 'amount'>> }) {
  const cat = useCatalog();
  const invalidate = useInvalidateMoney();
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: budget?.name ?? preset?.name ?? '',
      scope: budget?.scope ?? preset?.scope ?? 'overall',
      category: budget?.category ?? preset?.category ?? 'none',
      platform: budget?.platform ?? 'none',
      period: budget?.period ?? 'monthly',
      startDate: budget?.startDate?.slice(0, 10) ?? '',
      endDate: budget?.endDate?.slice(0, 10) ?? '',
      amount: budget ? String(budget.amountPaise / 100) : (preset?.amount ?? ''),
      thresholds: budget?.alertThresholds ?? [50, 80, 100],
      isActive: budget?.isActive ?? true,
    },
  });
  const scope = watch('scope');
  const period = watch('period');
  const thresholds = watch('thresholds');

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name,
        scope: v.scope,
        period: v.period,
        amountPaise: rupeesToPaise(v.amount),
        category: v.scope === 'category' ? v.category : null,
        platform: v.scope === 'platform' ? v.platform : null,
        startDate: v.period === 'custom' ? v.startDate : null,
        endDate: v.period === 'custom' ? v.endDate : null,
        alertThresholds: [...v.thresholds].sort((a, b) => a - b),
        isActive: v.isActive,
      };
      return budget ? api.patch<BudgetDto>(`/budgets/${budget.id}`, body) : api.post<BudgetDto>('/budgets', body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(budget ? 'Budget updated' : 'Budget created');
      onOpenChange(false);
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save the budget.' : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{budget ? 'Edit budget' : 'New budget'}</DialogTitle>
          <DialogDescription>A budget is a limit you set for yourself. Spendly tracks it and warns you — it never blocks or moves any money.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Name" error={errors.name?.message} htmlFor="b-name">
            <Input id="b-name" autoFocus placeholder="e.g. Food delivery" {...register('name')} aria-invalid={Boolean(errors.name)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applies to">
              <Controller control={control} name="scope" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="overall">All spending</SelectItem>
                    <SelectItem value="category">One category</SelectItem>
                    <SelectItem value="platform">One platform</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </Field>
            {scope === 'category' && (
              <Field label="Category" error={errors.category?.message}>
                <Controller control={control} name="category" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent className="max-h-72">{cat.spendingCategories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
            )}
            {scope === 'platform' && (
              <Field label="Platform" error={errors.platform?.message}>
                <Controller control={control} name="platform" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent className="max-h-72">{cat.platforms.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Limit (₹)" error={errors.amount?.message} htmlFor="b-amount">
              <Input id="b-amount" inputMode="decimal" placeholder="10,000" {...register('amount')} aria-invalid={Boolean(errors.amount)} />
            </Field>
            <Field label="Repeats">
              <Controller control={control} name="period" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Every month</SelectItem>
                    <SelectItem value="weekly">Every week</SelectItem>
                    <SelectItem value="custom">Between two dates</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </Field>
          </div>
          {period === 'custom' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" error={errors.startDate?.message} htmlFor="b-from"><Input id="b-from" type="date" {...register('startDate')} /></Field>
              <Field label="To" error={errors.endDate?.message} htmlFor="b-to"><Input id="b-to" type="date" {...register('endDate')} /></Field>
            </div>
          )}
          <fieldset>
            <legend className="mb-1.5 px-1 text-[13px] font-medium">Warn me at</legend>
            <div className="flex flex-wrap gap-2">
              {THRESHOLDS.map((t) => {
                const on = thresholds.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => setValue('thresholds', on ? thresholds.filter((x) => x !== t) : [...thresholds, t], { shouldValidate: true })} className={cn('rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                    {t}%
                  </button>
                );
              })}
            </div>
            {errors.thresholds?.message && <p role="alert" className="mt-1.5 px-1 text-xs text-bad">{errors.thresholds.message}</p>}
          </fieldset>
          {budget && (
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
              Active
              <Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Active" />} />
            </label>
          )}
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : budget ? 'Save changes' : 'Create budget'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

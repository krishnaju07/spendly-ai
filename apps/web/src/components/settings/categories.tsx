import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import type { CategoryDto } from '@spendly/shared';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { ApiRequestError, api } from '@/lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Give the category a name').max(60),
  kind: z.enum(['spending', 'income']),
  discretionary: z.boolean(),
  subcategories: z.string().max(600),
});
type Values = z.infer<typeof schema>;

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, control, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', kind: 'spending', discretionary: true, subcategories: '' } });
  const save = useMutation({
    mutationFn: (v: Values) => api.post<CategoryDto>('/categories', { name: v.name, kind: v.kind, discretionary: v.discretionary, subcategories: v.subcategories.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20) }),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      toast.success(`${c.name} added`);
      onClose();
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save.' : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>Use it when you assign transactions, in rules and in budgets.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Name" error={errors.name?.message} htmlFor="cat-name"><Input id="cat-name" autoFocus {...register('name')} aria-invalid={Boolean(errors.name)} /></Field>
          <Field label="Kind">
            <Controller control={control} name="kind" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="spending">Spending</SelectItem><SelectItem value="income">Income</SelectItem></SelectContent>
              </Select>
            )} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
            <span>Optional spending<span className="block text-xs text-muted-foreground">Counted when looking for ways to save.</span></span>
            <Controller control={control} name="discretionary" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Optional spending" />} />
          </label>
          <Field label="Subcategories (optional)" hint="Separate with commas." htmlFor="cat-sub"><Input id="cat-sub" {...register('subcategories')} /></Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Add category'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomCategories() {
  const cat = useCatalog();
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);
  const custom = cat.categories.filter((c) => c.isCustom);
  const del = useMutation({
    mutationFn: (c: CategoryDto) => api.delete<{ transactionsUncategorized: number }>(`/categories/${c.slug}`),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      await invalidate();
      toast.success(r.transactionsUncategorized ? `Removed — ${r.transactionsUncategorized} transaction${r.transactionsUncategorized === 1 ? ' is' : 's are'} now uncategorized and flagged for review` : 'Category removed');
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove the category'),
  });
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Your categories</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Add categories the built-in list does not cover.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus /> New category</Button>
      </div>
      {custom.length === 0 ? <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">You have not added any. The built-in categories cover food, shopping, travel, bills, subscriptions and more.</p> : (
        <ul className="divide-y">
          {custom.map((c) => (
            <li key={c.slug} className="flex items-center gap-3 py-3">
              <CategoryIcon icon={c.icon} color={seriesVar(c.slot)} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.name}</span><span className="block truncate text-xs text-muted-foreground">{c.subcategories.length ? c.subcategories.join(', ') : 'No subcategories'}</span></span>
              <Badge variant="default">{c.kind === 'income' ? 'Income' : c.discretionary ? 'Optional' : 'Essential'}</Badge>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
      {adding && <CategoryDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete “${deleting?.name ?? ''}”?`} description="Transactions in this category become uncategorized and are flagged for review. Rules and budgets that used it lose that category." confirmLabel="Delete category" destructive pending={del.isPending} onConfirm={() => deleting && del.mutate(deleting)} />
    </Card>
  );
}

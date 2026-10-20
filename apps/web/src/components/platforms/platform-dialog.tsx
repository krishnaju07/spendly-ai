import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PLATFORM_GROUPS, type PlatformDto } from '@spendly/shared';
import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { ApiRequestError, api } from '@/lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(60),
  group: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7C5CFF'),
  category: z.string(),
  aliases: z.string().max(800),
  website: z.string().trim().max(200).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Start with https://'),
});
type Values = z.infer<typeof schema>;

const splitAliases = (v: string) => [...new Set(v.split(/[\n,]/).map((a) => a.trim()).filter((a) => a.length >= 2))].slice(0, 20);

/** Create or edit a custom platform — a name, a colour and the statement text that identifies it. */
export function PlatformDialog({ open, onOpenChange, platform }: { open: boolean; onOpenChange: (o: boolean) => void; platform?: PlatformDto }) {
  const cat = useCatalog();
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: platform?.name ?? '',
      group: platform?.group ?? 'Other',
      color: platform?.color ?? '#64748B',
      category: platform?.category ?? 'none',
      aliases: platform?.aliases.join(', ') ?? '',
      website: platform?.website ?? '',
    },
  });
  const { register, handleSubmit, control, watch, formState: { errors } } = form;

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { name: v.name, group: v.group, color: v.color, category: v.category === 'none' ? null : v.category, aliases: splitAliases(v.aliases), website: v.website || null };
      return platform ? api.patch<PlatformDto>(`/platforms/${platform.slug}`, body) : api.post<PlatformDto>('/platforms', body);
    },
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      await invalidate();
      toast.success(platform ? `${p.name} updated` : `${p.name} added — future imports will recognise it`);
      onOpenChange(false);
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save. Please try again.' : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{platform ? 'Edit platform' : 'Add a custom platform'}</DialogTitle>
          <DialogDescription>For shops and services the built-in directory does not know. Spendly recognises them by the names you list below.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Name" error={errors.name?.message} htmlFor="pf-name">
            <Input id="pf-name" autoFocus {...register('name')} aria-invalid={Boolean(errors.name)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Group">
              <Controller
                control={control}
                name="group"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{PLATFORM_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Usual category" hint="Used for new transactions from this platform.">
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No default</SelectItem>
                      {cat.spendingCategories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field label="Colour" error={errors.color?.message} htmlFor="pf-color">
            <div className="flex items-center gap-3">
              <input type="color" aria-label="Pick a colour" value={watch('color')} onChange={(e) => form.setValue('color', e.target.value, { shouldValidate: true })} className="size-11 shrink-0 cursor-pointer rounded-full border border-input bg-transparent p-1" />
              <Input id="pf-color" {...register('color')} className="font-mono" aria-invalid={Boolean(errors.color)} />
            </div>
          </Field>
          <Field label="Names on your statements" hint="Separate with commas, e.g. ACME STORES, ACME RETAIL. Matched as whole words, ignoring case." error={errors.aliases?.message} htmlFor="pf-aliases">
            <Textarea id="pf-aliases" rows={2} {...register('aliases')} />
          </Field>
          <Field label="Website (optional)" error={errors.website?.message} htmlFor="pf-web">
            <Input id="pf-web" inputMode="url" placeholder="https://" {...register('website')} aria-invalid={Boolean(errors.website)} />
          </Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : platform ? 'Save changes' : 'Add platform'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

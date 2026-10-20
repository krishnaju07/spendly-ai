import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FlaskConical, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { RULE_FIELDS, RULE_MATCH_TYPES, TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, validateRulePattern, type ClassificationSource, type RuleDto, type TransactionType } from '@spendly/shared';
import { ConfidenceBadge, confidenceLevel } from '@/components/common/chips';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Field } from '@/components/common/field';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, SectionTitle } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { ApiRequestError, api } from '@/lib/api';
import { FIELD_LABEL, MATCH_LABEL, SOURCE_LABEL } from '@/lib/labels';
import { plural } from '@/lib/format';

interface Preview {
  merchantName: string;
  platform: string | null;
  platformName: string;
  category: string | null;
  categoryName: string;
  subcategory: string | null;
  confidence: number;
  source: ClassificationSource;
  reason: string;
  needsReview: boolean;
}

/** A dry run: type what a statement says and see what Spendly would make of it, without saving anything. */
function Tester() {
  const cat = useCatalog();
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const test = useMutation({ mutationFn: () => api.post<Preview>('/rules/preview', { merchant: merchant.trim() || undefined, description: description.trim() || undefined }) });
  const r = test.data;
  const level = confidenceLevel(r?.confidence ?? 0);
  return (
    <Card className="gap-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-muted"><FlaskConical className="size-[18px]" aria-hidden /></span>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">Test how a name is recognised</h3>
          <p className="text-[13px] text-muted-foreground">Paste what appears on a statement. Nothing is saved.</p>
        </div>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (merchant.trim() || description.trim()) test.mutate();
        }}
      >
        <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant, e.g. SWIGGY LIMITED" aria-label="Merchant" maxLength={200} />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Or the full narration, e.g. UPI/…/ZOMATO" aria-label="Description" maxLength={500} />
        <Button type="submit" disabled={test.isPending || (!merchant.trim() && !description.trim())}>{test.isPending ? 'Testing…' : 'Test'}</Button>
      </form>
      {test.isError && <p role="alert" className="text-sm text-bad">{test.error instanceof Error ? test.error.message : 'Could not test that.'}</p>}
      {r && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 p-4" aria-live="polite">
          <PlatformLogo platform={cat.platform(r.platform)} size={40} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{r.platform ? r.platformName : r.merchantName || 'Unknown merchant'}</p>
            <p className="text-[13px] text-muted-foreground">{r.category ? r.categoryName : 'No category'}{r.subcategory ? ` · ${r.subcategory}` : ''} · {SOURCE_LABEL[r.source]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {r.confidence > 0 ? <ConfidenceBadge level={level} score={r.confidence} /> : <Badge variant="bad">No match</Badge>}
            {r.needsReview && <Badge variant="warn">Would be flagged for review</Badge>}
          </div>
        </div>
      )}
    </Card>
  );
}

const schema = z
  .object({
    name: z.string().trim().max(80),
    matchType: z.enum(RULE_MATCH_TYPES),
    pattern: z.string().trim().min(1, 'Enter the text to look for').max(160),
    field: z.enum(RULE_FIELDS),
    platform: z.string(),
    category: z.string(),
    type: z.string(),
    priority: z.string().regex(/^\d{1,4}$/, 'Use a number from 0 to 1000'),
  })
  .superRefine((v, ctx) => {
    const check = validateRulePattern(v.matchType, v.pattern);
    if (!check.ok) ctx.addIssue({ code: 'custom', path: ['pattern'], message: check.reason });
    if (v.platform === 'none' && v.category === 'none' && v.type === 'any') ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose a platform, a category or a type to apply' });
    if (Number(v.priority) > 1000) ctx.addIssue({ code: 'custom', path: ['priority'], message: 'Use a number from 0 to 1000' });
  });
type Values = z.infer<typeof schema>;

function RuleDialog({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (o: boolean) => void; rule?: RuleDto }) {
  const cat = useCatalog();
  const qc = useQueryClient();
  const { register, handleSubmit, control, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: rule?.name ?? '',
      matchType: rule?.matchType ?? 'contains',
      pattern: rule?.pattern ?? '',
      field: rule?.field ?? 'any',
      platform: rule?.platform ?? 'none',
      category: rule?.category ?? 'none',
      type: rule?.type ?? 'any',
      priority: String(rule?.priority ?? 100),
    },
  });
  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { name: v.name || undefined, matchType: v.matchType, pattern: v.pattern, field: v.field, platform: v.platform === 'none' ? null : v.platform, category: v.category === 'none' ? null : v.category, type: v.type === 'any' ? null : (v.type as TransactionType), priority: Number(v.priority) };
      return rule ? api.patch<RuleDto>(`/rules/${rule.id}`, body) : api.post<RuleDto>('/rules', body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rules'] });
      toast.success(rule ? 'Rule updated' : 'Rule added — use “Apply to existing” to re-check past transactions');
      onOpenChange(false);
    },
  });
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save the rule.' : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>When a transaction matches, Spendly applies what you choose below. Your rules always beat the built-in directory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <Field label="When it">
              <Controller control={control} name="matchType" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_MATCH_TYPES.map((m) => <SelectItem key={m} value={m}>{MATCH_LABEL[m]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Text" error={errors.pattern?.message} htmlFor="rule-pattern">
              <Input id="rule-pattern" autoFocus placeholder="e.g. SHARMA STORES" {...register('pattern')} aria-invalid={Boolean(errors.pattern)} />
            </Field>
          </div>
          <Field label="Look in">
            <Controller control={control} name="field" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_FIELDS.map((f) => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <fieldset className="space-y-3 rounded-2xl border p-4">
            <legend className="px-1 text-[13px] font-medium">Then set</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Platform">
                <Controller control={control} name="platform" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">Leave as is</SelectItem>
                      {cat.platforms.map((p) => <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Category" error={errors.category?.message}>
                <Controller control={control} name="category" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">Leave as is</SelectItem>
                      {cat.categories.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Type">
                <Controller control={control} name="type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Leave as is</SelectItem>
                      {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TRANSACTION_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
              <Field label="Priority" hint="Higher wins when rules overlap." error={errors.priority?.message} htmlFor="rule-priority">
                <Input id="rule-priority" inputMode="numeric" {...register('priority')} aria-invalid={Boolean(errors.priority)} />
              </Field>
            </div>
          </fieldset>
          <Field label="Name (optional)" htmlFor="rule-name">
            <Input id="rule-name" placeholder="A note for yourself" {...register('name')} />
          </Field>
          {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : rule ? 'Save rule' : 'Add rule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel() {
  const cat = useCatalog();
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api.get<RuleDto[]>('/rules') });
  const [editing, setEditing] = useState<RuleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RuleDto | null>(null);
  const [reapply, setReapply] = useState(false);

  const toggle = useMutation({
    mutationFn: (r: RuleDto) => api.patch<RuleDto>(`/rules/${r.id}`, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the rule'),
  });
  const del = useMutation({
    mutationFn: (r: RuleDto) => api.delete(`/rules/${r.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rules'] });
      toast.success('Rule deleted — past transactions keep what they were given');
      setDeleting(null);
    },
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ scanned: number; changed: number }>('/rules/reapply'),
    onSuccess: async (r) => {
      await invalidate();
      await qc.invalidateQueries({ queryKey: ['rules'] });
      toast.success(r.changed ? `Updated ${plural(r.changed, 'transaction')} out of ${r.scanned.toLocaleString('en-IN')} checked` : `Checked ${r.scanned.toLocaleString('en-IN')} — nothing needed changing`);
      setReapply(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not re-run the rules'),
  });

  return (
    <div className="space-y-4">
      <Tester />
      <section aria-label="Your rules" className="space-y-3">
        <SectionTitle
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReapply(true)}><RefreshCw /> Apply to existing</Button>
              <Button size="sm" onClick={() => setEditing('new')}><Plus /> New rule</Button>
            </div>
          }
        >
          Your rules
        </SectionTitle>
        {rules.isPending ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}</div>
        ) : rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => rules.refetch()} compact />
        ) : rules.data.length === 0 ? (
          <EmptyState className="rounded-[28px] border bg-card" icon={Sparkles} title="No rules yet" description="When you correct a platform or category, Spendly offers to remember it. You can also write a rule by hand, for example “SHARMA STORES → Groceries”." action={{ label: 'New rule', onClick: () => setEditing('new') }} />
        ) : (
          <ul className="space-y-2">
            {rules.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border bg-card p-4 shadow-card">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{r.name || r.pattern}</span>
                    {r.source === 'learned' && <Badge variant="default"><Sparkles aria-hidden /> Learned</Badge>}
                    {!r.isActive && <Badge variant="outline">Paused</Badge>}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    If {FIELD_LABEL[r.field]} {MATCH_LABEL[r.matchType]} <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{r.pattern}</span>
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    {r.platform && <Badge variant="outline">{cat.platformName(r.platform)}</Badge>}
                    {r.category && <Badge variant="outline">{cat.categoryName(r.category)}</Badge>}
                    {r.type && <Badge variant="outline">{TRANSACTION_TYPE_LABELS[r.type]}</Badge>}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground tnum">{r.hitCount ? `${plural(r.hitCount, 'match', 'matches')}` : 'No matches yet'} · priority {r.priority}</p>
                <div className="flex items-center gap-1">
                  <Switch checked={r.isActive} onCheckedChange={() => toggle.mutate(r)} aria-label={`${r.isActive ? 'Pause' : 'Resume'} rule ${r.name || r.pattern}`} />
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit rule ${r.name || r.pattern}`} onClick={() => setEditing(r)}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete rule ${r.name || r.pattern}`} onClick={() => setDeleting(r)}><Trash2 /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <RuleDialog open onOpenChange={(o) => !o && setEditing(null)} rule={editing === 'new' ? undefined : editing} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this rule?" description="Transactions it already classified keep their platform and category. New ones will no longer follow this rule." confirmLabel="Delete rule" destructive pending={del.isPending} onConfirm={() => deleting && del.mutate(deleting)} />
      <ConfirmDialog open={reapply} onOpenChange={setReapply} title="Apply rules to existing transactions?" description="Spendly re-checks transactions that were classified automatically. Anything you set or edited yourself is never changed." confirmLabel="Apply now" pending={apply.isPending} onConfirm={() => apply.mutate()} />
    </div>
  );
}

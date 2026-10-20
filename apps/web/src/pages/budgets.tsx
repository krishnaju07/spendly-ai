import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, Gauge, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BudgetDto, BudgetHistoryDto, BudgetSuggestionDto } from '@spendly/shared';
import { BudgetDialog } from '@/components/budgets/budget-dialog';
import { ConfidenceBadge, LevelBadge, StatementBadge } from '@/components/common/chips';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { CountUp } from '@/components/common/count-up';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { EmptyState, ErrorState, PageHeader, SectionTitle } from '@/components/common/states';
import { ColumnChart, type Column } from '@/components/charts/columns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCatalog } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { api } from '@/lib/api';
import { inrRound } from '@/lib/format';
import { cn } from '@/lib/utils';

const LEVEL = { ok: { meter: 'ok', label: 'On track' }, warning: { meter: 'warn', label: 'Nearing the limit' }, exceeded: { meter: 'bad', label: 'Over budget' } } as const;

function History({ id, amountPaise }: { id: string; amountPaise: number }) {
  const q = useQuery({ queryKey: ['budgets', 'history', id], queryFn: () => api.get<BudgetHistoryDto>(`/budgets/${id}/history`) });
  if (q.isPending) return <Skeleton className="h-44 rounded-2xl" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} compact />;
  const data: Column[] = q.data.points.map((p) => ({ key: p.key, label: p.label, value: p.spentPaise, color: p.level === 'exceeded' ? 'var(--status-serious)' : undefined, extra: [{ label: 'Budget', value: inrRound(p.amountPaise) }, { label: 'Used', value: `${Math.round(p.percentUsed)}%` }] }));
  return (
    <div>
      <div role="img" aria-label="Spending against this budget in recent periods" className="h-44"><ColumnChart data={data} refLine={{ value: amountPaise, label: 'Budget' }} seriesLabel="Spent" /></div>
      <p className="mt-2 text-xs text-muted-foreground">Periods in orange went over the budget.</p>
    </div>
  );
}

function BudgetCard({ b, onEdit, onDelete }: { b: BudgetDto; onEdit: () => void; onDelete: () => void }) {
  const cat = useCatalog();
  const [open, setOpen] = useState(false);
  const lv = LEVEL[b.progress.level];
  const platform = cat.platform(b.platform);
  const category = cat.category(b.category);
  const over = b.progress.remainingPaise < 0;
  const pr = b.projection;
  const projOver = pr ? pr.projectedPaise - b.amountPaise : 0;
  return (
    <Card className={cn('gap-4', !b.isActive && 'opacity-70')}>
      <div className="flex items-start gap-3">
        {b.scope === 'platform' ? <PlatformLogo platform={platform} size={42} /> : b.scope === 'category' ? <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={42} /> : <span className="grid size-[42px] place-items-center rounded-full bg-muted"><Gauge className="size-5" aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <h3 className="truncate leading-tight font-semibold tracking-tight">{b.name}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{b.window.label}{!b.isActive && ' · paused'}</p>
        </div>
        <div className="flex">
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${b.name}`} onClick={onEdit}><Pencil /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={onDelete}><Trash2 /></Button>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <Money paise={b.progress.spentPaise} size="xl" />
            <p className="mt-1.5 text-[13px] text-muted-foreground tnum">of {inrRound(b.amountPaise)}</p>
          </div>
          <LevelBadge level={lv.meter}>{lv.label}</LevelBadge>
        </div>
        <div className="relative mt-4">
          <Progress value={b.progress.percentUsed} level={lv.meter} label={`${b.name}: ${Math.round(b.progress.percentUsed)}% used`} className="h-2.5" />
          {b.alertThresholds.filter((t) => t < 100).map((t) => <span key={t} aria-hidden className="absolute top-0 h-2.5 w-0.5 bg-card" style={{ left: `${t}%` }} />)}
        </div>
        <p className="mt-2 flex justify-between gap-3 text-[13px] tnum">
          <span className="text-muted-foreground">{Math.round(b.progress.percentUsed)}% used</span>
          <span className={over ? 'font-medium text-bad' : 'font-medium'}>{over ? `${inrRound(-b.progress.remainingPaise)} over` : `${inrRound(b.progress.remainingPaise)} left`}</span>
        </p>
      </div>

      {pr && (
        <div className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-2">
            {pr.method === 'run_rate' ? <StatementBadge kind="estimate" /> : <StatementBadge kind="verified" />}
            <span>
              {pr.method === 'final'
                ? `Final total ${inrRound(pr.projectedPaise)}.`
                : projOver > 0
                  ? `At this pace you would end near ${inrRound(pr.projectedPaise)} — about ${inrRound(projOver)} over.`
                  : `At this pace you would end near ${inrRound(pr.projectedPaise)} — about ${inrRound(-projOver)} under.`}
            </span>
          </p>
          {pr.method === 'run_rate' && <p className="mt-1.5 text-xs text-muted-foreground">{pr.note} Confidence: {pr.confidence}.</p>}
        </div>
      )}

      <div>
        <Button size="xs" variant="ghost" className="-ml-2 text-muted-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Past periods <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
        {open && <div className="mt-2"><History id={b.id} amountPaise={b.amountPaise} /></div>}
      </div>
    </Card>
  );
}

export default function Budgets() {
  const invalidate = useInvalidateMoney();
  const cat = useCatalog();
  const budgets = useQuery({ queryKey: ['budgets', 'list'], queryFn: () => api.get<BudgetDto[]>('/budgets') });
  const suggestions = useQuery({ queryKey: ['budgets', 'suggestions'], queryFn: () => api.get<BudgetSuggestionDto[]>('/budgets/suggestions') });
  const [editing, setEditing] = useState<BudgetDto | 'new' | { preset: BudgetSuggestionDto } | null>(null);
  const [deleting, setDeleting] = useState<BudgetDto | null>(null);

  const del = useMutation({
    mutationFn: (b: BudgetDto) => api.delete(`/budgets/${b.id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('Budget deleted');
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete the budget'),
  });

  const list = budgets.data ?? [];
  const active = list.filter((b) => b.isActive);
  const overall = active.find((b) => b.scope === 'overall' && b.period === 'monthly');
  const attention = active.filter((b) => b.progress.level !== 'ok').length;

  return (
    <div className="space-y-5">
      <PageHeader title="Budgets" subtitle="Limits you set for yourself. Spendly tracks them against your real spending and warns you early — it never blocks a payment." actions={<Button size="sm" onClick={() => setEditing('new')}><Plus /> New budget</Button>} />

      {budgets.isError ? <ErrorState error={budgets.error} onRetry={() => budgets.refetch()} /> : budgets.isPending ? (
        <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-3xl" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState className="rounded-[32px] border bg-card" icon={Gauge} title="No budgets yet" description="Set a monthly limit for everything, or for one category like food delivery. Spendly will show how you are pacing and warn you before you cross it." action={{ label: 'Create a budget', onClick: () => setEditing('new') }} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Summary">
            <div className="col-span-2 rounded-[28px] bg-tile p-5 lg:col-span-1">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">{overall ? 'Left this month' : 'Active budgets'}</p>
              <div className="mt-2">{overall ? <Money paise={Math.max(0, overall.progress.remainingPaise)} size="xl" /> : <span className="type-xl text-[34px] leading-none">{active.length}</span>}</div>
              <p className="mt-2 text-xs text-muted-foreground">{overall ? `of ${inrRound(overall.amountPaise)} (${overall.name})` : 'Add an overall monthly budget to see what is left.'}</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Needs attention</p>
              <p className="mt-2 type-xl text-[34px] leading-none tnum"><CountUp value={attention} /></p>
              <p className="mt-2 text-xs text-muted-foreground">{attention ? 'Nearing or over the limit' : 'Everything is on track'}</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Total tracked</p>
              <p className="mt-2 type-xl text-[34px] leading-none tnum"><CountUp value={list.length} /></p>
              <p className="mt-2 text-xs text-muted-foreground">{list.length - active.length ? `${list.length - active.length} paused` : 'All active'}</p>
            </div>
          </section>
          <div className="stagger grid gap-4 xl:grid-cols-2">
            {list.map((b) => <BudgetCard key={b.id} b={b} onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />)}
          </div>
        </>
      )}

      {(suggestions.data ?? []).length > 0 && (
        <section className="space-y-3" aria-label="Suggested budgets">
          <SectionTitle>Suggested budgets</SectionTitle>
          <p className="max-w-prose text-[13px] text-muted-foreground">Based on your own spending in recent complete months, rounded up a little so a normal month fits. These are suggestions, not targets.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(suggestions.data ?? []).map((s) => (
              <Card key={`${s.scope}-${s.category}`} className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{s.scope === 'overall' ? 'All spending' : cat.categoryName(s.category)} · monthly</p>
                  </div>
                  <Money paise={s.amountPaise} size="lg" />
                </div>
                <p className="text-xs text-muted-foreground">{s.basis}</p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <ConfidenceBadge level={s.confidence} />
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ preset: s })}>Review & create</Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <BudgetDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          budget={editing === 'new' || 'preset' in editing ? undefined : editing}
          preset={typeof editing === 'object' && 'preset' in editing ? { name: editing.preset.name, scope: editing.preset.scope, category: editing.preset.category ?? 'none', amount: String(editing.preset.amountPaise / 100) } : undefined}
        />
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete “${deleting?.name ?? ''}”?`} description="Your transactions are untouched. Only the budget and its alerts are removed." confirmLabel="Delete budget" destructive pending={del.isPending} onConfirm={() => deleting && del.mutate(deleting)} />
    </div>
  );
}

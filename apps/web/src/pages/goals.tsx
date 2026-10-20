import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Pencil, PiggyBank, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { GoalDto } from '@spendly/shared';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LevelBadge } from '@/components/common/chips';
import { CountUp } from '@/components/common/count-up';
import { Money } from '@/components/common/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/states';
import { ContributionDialog, GOAL_TYPE_LABEL, GoalDialog, ScenarioDialog } from '@/components/goals/goal-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDate, inrRound, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

/** A single arc on a track — the app's ring motif at goal scale. */
function GoalRing({ pct, done }: { pct: number; done: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative size-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="size-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={done ? 'var(--series-3)' : 'var(--series-1)'} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(clamped / 100) * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold tracking-tight tnum">{done ? <Check className="size-6" strokeWidth={2.5} aria-label="Reached" /> : `${Math.round(clamped)}%`}</span>
    </div>
  );
}

function GoalCard({ g, tz, onEdit, onDelete, onAdd, onScenario, onRemoveContribution }: { g: GoalDto; tz: string; onEdit: () => void; onDelete: () => void; onAdd: () => void; onScenario: () => void; onRemoveContribution: (cid: string) => void }) {
  const [open, setOpen] = useState(false);
  const done = g.status === 'completed' || g.savedAmountPaise >= g.targetAmountPaise;
  const pastDue = !done && g.monthsLeft <= 0;
  return (
    <Card className="gap-5">
      <div className="flex items-start gap-4">
        <GoalRing pct={g.progressPct} done={done} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg leading-tight font-semibold tracking-tight break-words">{g.name}</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{GOAL_TYPE_LABEL[g.type as keyof typeof GOAL_TYPE_LABEL] ?? 'Goal'}</p>
            </div>
            <div className="flex shrink-0">
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${g.name}`} onClick={onEdit}><Pencil /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${g.name}`} onClick={onDelete}><Trash2 /></Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <Money paise={g.savedAmountPaise} size="xl" />
            <span className="text-sm text-muted-foreground tnum">of {inrRound(g.targetAmountPaise)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {done ? <Badge variant="ok"><Check aria-hidden /> Goal reached</Badge> : g.onTrack === true ? <LevelBadge level="ok">On pace</LevelBadge> : g.onTrack === false ? <LevelBadge level="warn">Behind pace</LevelBadge> : <Badge variant="default">Add savings to see your pace</Badge>}
        <span className="text-muted-foreground">by {formatDate(g.targetDate, tz, 'long')}{!done && (pastDue ? ' · date has passed' : ` · ${plural(g.monthsLeft, 'month')} left`)}</span>
      </div>

      {!done && (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-muted/60 px-4 py-3">
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Still to save</dt>
            <dd className="mt-1 font-semibold tnum">{inrRound(g.remainingPaise)}</dd>
          </div>
          <div className="rounded-2xl bg-muted/60 px-4 py-3">
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Needed a month</dt>
            <dd className="mt-1 font-semibold tnum">{pastDue ? 'Set a new date' : inrRound(g.suggestedMonthlyPaise)}</dd>
            {g.recentMonthlyPaise !== null && <dd className="mt-0.5 text-xs text-muted-foreground tnum">You have added ~{inrRound(g.recentMonthlyPaise)}/mo lately</dd>}
          </div>
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!done && <Button size="sm" onClick={onAdd}><Plus /> Add savings</Button>}
        {!done && <Button size="sm" variant="secondary" onClick={onScenario}><Sparkles /> What if…</Button>}
        <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {plural(g.contributions.length, 'entry', 'entries')} <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {open && (
        g.contributions.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p> : (
          <ul className="divide-y rounded-2xl border">
            {[...g.contributions].reverse().map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground tnum">{formatDate(c.date, tz)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.note || '—'}</span>
                <span className="font-medium tnum">{inrRound(c.amountPaise)}</span>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${inrRound(c.amountPaise)} entry`} onClick={() => onRemoveContribution(c.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )
      )}
      {g.notes && <p className="text-[13px] text-muted-foreground">{g.notes}</p>}
    </Card>
  );
}

export default function Goals() {
  const { prefs } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['goals'], queryFn: () => api.get<GoalDto[]>('/savings-goals') });
  const [dialog, setDialog] = useState<{ kind: 'goal'; goal?: GoalDto } | { kind: 'add' | 'scenario'; goal: GoalDto } | null>(null);
  const [deleting, setDeleting] = useState<GoalDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['goals'] });

  const del = useMutation({
    mutationFn: (g: GoalDto) => api.delete(`/savings-goals/${g.id}`),
    onSuccess: async () => {
      await refresh();
      toast.success('Goal deleted');
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete the goal'),
  });
  const removeContribution = useMutation({
    mutationFn: ({ g, cid }: { g: GoalDto; cid: string }) => api.delete(`/savings-goals/${g.id}/contributions/${cid}`),
    onSuccess: async () => {
      await refresh();
      toast.success('Entry removed');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove that entry'),
  });

  const goals = q.data ?? [];
  const active = goals.filter((g) => g.status !== 'completed' && g.savedAmountPaise < g.targetAmountPaise);
  const sum = (f: (g: GoalDto) => number) => goals.reduce((a, g) => a + f(g), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Savings Goals" subtitle="Track what you are saving towards. Goals are trackers only — Spendly never moves, holds or invests your money." actions={<Button size="sm" onClick={() => setDialog({ kind: 'goal' })}><Plus /> New goal</Button>} />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isPending ? (
        <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-3xl" />)}</div>
      ) : goals.length === 0 ? (
        <EmptyState className="rounded-[32px] border bg-card" icon={PiggyBank} title="No goals yet" description="Pick something you are saving for — an emergency fund, a laptop, a trip. Spendly shows the monthly amount you need and how trimming a category could get you there sooner." action={{ label: 'Create a goal', onClick: () => setDialog({ kind: 'goal' }) }} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Totals">
            <div className="col-span-2 rounded-[28px] bg-tile p-5 lg:col-span-1">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Saved across goals</p>
              <div className="mt-2"><Money paise={sum((g) => g.savedAmountPaise)} size="xl" /></div>
              <p className="mt-2 text-xs text-muted-foreground tnum">of {inrRound(sum((g) => g.targetAmountPaise))} in total</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">In progress</p>
              <p className="mt-2 type-xl text-[34px] leading-none tnum"><CountUp value={active.length} /></p>
              <p className="mt-2 text-xs text-muted-foreground">{goals.length - active.length ? `${goals.length - active.length} reached` : 'None reached yet'}</p>
            </div>
            <div className="rounded-[28px] bg-tile p-5">
              <p className="text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Needed a month</p>
              <div className="mt-2"><Money paise={Math.round(active.filter((g) => g.monthsLeft > 0).reduce((a, g) => a + g.suggestedMonthlyPaise, 0) / 100) * 100} size="lg" decimals="never" animate /></div>
              <p className="mt-2 text-xs text-muted-foreground">to finish every active goal on time</p>
            </div>
          </section>
          <div className="stagger grid gap-4 xl:grid-cols-2">
            {goals.map((g) => (
              <GoalCard key={g.id} g={g} tz={prefs.timezone} onEdit={() => setDialog({ kind: 'goal', goal: g })} onDelete={() => setDeleting(g)} onAdd={() => setDialog({ kind: 'add', goal: g })} onScenario={() => setDialog({ kind: 'scenario', goal: g })} onRemoveContribution={(cid) => removeContribution.mutate({ g, cid })} />
            ))}
          </div>
        </>
      )}

      {dialog?.kind === 'goal' && <GoalDialog goal={dialog.goal} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'add' && <ContributionDialog goal={dialog.goal} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'scenario' && <ScenarioDialog goal={dialog.goal} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete “${deleting?.name ?? ''}”?`} description="The goal and its savings entries are removed. This cannot be undone." confirmLabel="Delete goal" destructive pending={del.isPending} onConfirm={() => deleting && del.mutate(deleting)} />
    </div>
  );
}

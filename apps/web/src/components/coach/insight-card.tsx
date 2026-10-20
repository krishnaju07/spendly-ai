import { useState } from 'react';
import { ChevronDown, Info, ThumbsUp, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router';
import type { InsightDto } from '@spendly/shared';
import { ConfidenceBadge, StatementBadge } from '@/components/common/chips';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { transactionsLink } from '@/lib/filters';
import { inrRound } from '@/lib/format';
import { cn } from '@/lib/utils';

const SEVERITY = {
  warning: { icon: TriangleAlert, tone: 'bg-warn-soft text-warn', label: 'Worth a look' },
  positive: { icon: ThumbsUp, tone: 'bg-ok-soft text-ok', label: 'Going well' },
  info: { icon: Info, tone: 'bg-muted text-muted-foreground', label: 'For your information' },
} as const;

/**
 * One behavioural insight. Verified facts, estimates and suggestions are labelled apart, and the
 * calculation behind the figures is one click away — nothing here is a black box.
 */
export function InsightCard({ insight, onDismiss, dismissing, compact }: { insight: InsightDto; onDismiss?: () => void; dismissing?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[insight.severity];
  const Icon = sev.icon;
  const e = insight.evidence;
  const link = transactionsLink({ from: e.periodFrom, to: e.periodTo }, { category: e.scope?.category, platform: e.scope?.platform });
  return (
    <article className={cn('rounded-3xl border bg-card shadow-card', compact ? 'p-4' : 'p-5')}>
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', sev.tone)}>
          <Icon className="size-[18px]" aria-hidden />
          <span className="sr-only">{sev.label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="leading-snug font-semibold tracking-tight">{insight.title}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{insight.summary}</p>
        </div>
        {onDismiss && (
          <Button size="icon-sm" variant="ghost" aria-label={`Dismiss “${insight.title}”`} onClick={onDismiss} disabled={dismissing}>
            <X />
          </Button>
        )}
      </div>

      {insight.statements.length > 0 && (
        <ul className="mt-4 space-y-2">
          {insight.statements.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <StatementBadge kind={s.kind} className="mt-px" />
              <span className="min-w-0 flex-1">{s.text}</span>
            </li>
          ))}
        </ul>
      )}

      {insight.estimatedMonthlySavingsPaise ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3.5 py-2.5 text-[13px]">
          <StatementBadge kind="estimate" />
          Could free up around <strong className="tnum">{inrRound(insight.estimatedMonthlySavingsPaise)}</strong> a month if you acted on this.
        </p>
      ) : null}
      {insight.action && <p className="mt-3 text-[13px]"><span className="font-medium">Next step: </span>{insight.action}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ConfidenceBadge level={insight.confidenceLabel} score={insight.confidence} />
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button size="xs" variant="ghost" className="text-muted-foreground">
              How this was calculated <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
        </Collapsible>
        <Button size="xs" variant="ghost" asChild className="ml-auto">
          <Link to={link}>See transactions</Link>
        </Button>
      </div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent>
          <div className="mt-3 rounded-2xl bg-muted/60 p-4 text-[13px]">
            <p className="text-xs text-muted-foreground">
              Period {e.periodFrom} to {e.periodTo}
              {e.baselineFrom && e.baselineTo ? ` · compared with ${e.baselineFrom} to ${e.baselineTo}` : ''}
              {e.txnCount !== undefined ? ` · ${e.txnCount} transaction${e.txnCount === 1 ? '' : 's'}` : ''}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {e.calculation.map((c, i) => <li key={i} className="tnum">{c}</li>)}
            </ol>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

import { useState } from 'react';
import { ArrowRight, ChevronDown, FlaskConical, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { CoachAnswer } from '@spendly/shared';
import { ConfidenceBadge, Delta, StatementBadge } from '@/components/common/chips';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A coach answer, laid out so the reader can tell what is proven from what is guessed:
 * the headline, verified/estimated figures, the working, the data coverage and a confidence level.
 */
export function AnswerCard({ answer, onFollowUp }: { answer: CoachAnswer; onFollowUp: (prompt: string) => void }) {
  const [maths, setMaths] = useState(false);
  const c = answer.coverage;
  const maxRow = Math.max(...answer.breakdown.map((r) => Math.abs(r.paise)), 1);
  const reworded = answer.explanation.source === 'llm';
  return (
    <article className="reveal rounded-[32px] border bg-card p-5 shadow-card sm:p-7" aria-label={`Answer: ${answer.question}`}>
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <span className="rounded-full bg-muted px-3 py-1 text-foreground">{answer.question}</span>
        {answer.period && <Badge variant="default">{answer.period.label}</Badge>}
        {answer.baseline && <Badge variant="default">vs {answer.baseline.label}</Badge>}
        {c.isDemo && <Badge variant="warn"><FlaskConical aria-hidden /> Demo data</Badge>}
      </p>

      <h2 className="type-headline mt-4 text-[22px] leading-[1.28] sm:text-[26px]">{answer.headline}</h2>
      {reworded && answer.explanation.text && (
        <div className="mt-3 max-w-prose">
          <p className="text-[15px] leading-relaxed text-foreground/90">{answer.explanation.text}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
            Reworded by your AI provider; every figure was checked against your data.
          </p>
        </div>
      )}
      {answer.explanation.validation && !answer.explanation.validation.passed && (
        <ul className="mt-3 space-y-1 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn" role="status">
          {answer.explanation.validation.issues.map((i, k) => <li key={k}>{i}</li>)}
        </ul>
      )}

      {answer.metrics.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {answer.metrics.map((m) => (
            <div key={m.key} className="rounded-2xl bg-muted/60 px-4 py-3">
              <dt className="flex items-center justify-between gap-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                <span>{m.label}</span>
                {m.kind === 'estimate' && <StatementBadge kind="estimate" />}
              </dt>
              <dd className="mt-1.5 text-xl leading-tight font-semibold tracking-tight tnum">{m.display}</dd>
            </div>
          ))}
        </dl>
      )}

      {answer.breakdown.length > 0 && (
        <ul className="mt-6 space-y-3" aria-label="Breakdown">
          {answer.breakdown.map((r, i) => (
            <li key={`${r.slug ?? r.label}-${i}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <span className="flex items-center gap-2 tnum">
                  {r.changePct !== null && r.changePct !== undefined && Math.abs(r.changePct) >= 1 && <Delta value={r.changePct} />}
                  <span className="font-semibold">{r.display}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(2, (Math.abs(r.paise) / maxRow) * 100)}%` }} /></div>
              {(r.count !== undefined || (r.sharePct !== null && r.sharePct !== undefined)) && (
                <p className="mt-1 text-xs text-muted-foreground tnum">{r.sharePct !== null && r.sharePct !== undefined ? `${Math.round(r.sharePct)}% of the total` : ''}{r.count !== undefined ? `${r.sharePct !== null && r.sharePct !== undefined ? ' · ' : ''}${plural(r.count, 'transaction')}` : ''}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {answer.statements.length > 0 && (
        <ul className="mt-6 space-y-2.5">
          {answer.statements.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[14px]">
              <StatementBadge kind={s.kind} className="mt-0.5" />
              <span className="min-w-0 flex-1">{s.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {answer.nextAction?.href && <Button size="sm" asChild><Link to={answer.nextAction.href}>{answer.nextAction.label} <ArrowRight /></Link></Button>}
        {answer.nextAction?.prompt && <Button size="sm" variant="secondary" onClick={() => onFollowUp(answer.nextAction!.prompt!)}>{answer.nextAction.label} <ArrowRight /></Button>}
        {answer.transactionsHref && <Button size="sm" variant="secondary" asChild><Link to={answer.transactionsHref}>See the transactions</Link></Button>}
      </div>

      <div className="mt-6 space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge level={answer.confidence.level} />
          <span className="text-[13px] text-muted-foreground">{answer.confidence.reason}</span>
        </div>
        <p className="text-xs text-muted-foreground tnum">
          Based on {plural(c.transactionsConsidered, 'transaction')}
          {c.firstTransactionDate && c.lastTransactionDate ? ` between ${c.firstTransactionDate} and ${c.lastTransactionDate}` : ''}.
          {c.uncategorizedSharePct ? ` ${Math.round(c.uncategorizedSharePct)}% of spending is uncategorized, which can hide patterns.` : ''}
        </p>
        {c.notes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
        {answer.assumptions.length > 0 && (
          <div className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px]">
            <p className="font-medium">What I assumed</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{answer.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
        {answer.calculation.length > 0 && (
          <Collapsible open={maths} onOpenChange={setMaths}>
            <CollapsibleTrigger asChild>
              <Button size="xs" variant="ghost" className="-ml-2 text-muted-foreground">Show the working <ChevronDown className={cn('transition-transform', maths && 'rotate-180')} /></Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-2 list-decimal space-y-1.5 rounded-2xl bg-muted/60 py-3 pr-4 pl-9 text-[13px] tnum">
                {answer.calculation.map((l, i) => <li key={i}>{l}</li>)}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        )}
        <p className="text-[11px] text-muted-foreground/80">{answer.disclaimer}</p>
      </div>
    </article>
  );
}

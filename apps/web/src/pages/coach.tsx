import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { AiStatusDto, CoachAnswer, InsightsResponseDto, QueryPlan } from '@spendly/shared';
import { StatementBadge } from '@/components/common/chips';
import { EmptyState, ErrorState, PageHeader, SectionTitle } from '@/components/common/states';
import { AnswerCard } from '@/components/coach/answer-card';
import { InsightCard } from '@/components/coach/insight-card';
import { Money } from '@/components/common/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, api } from '@/lib/api';

const SUGGESTIONS = [
  'How much did I spend on food delivery last month?',
  'Which platform costs me the most?',
  'Compare Zomato and Swiggy this month',
  'Why is my spending higher this month?',
  'What if I reduce online shopping by 20%?',
  'Which subscriptions should I review?',
  'Where can I save money?',
  'Am I on track with my budget?',
];

interface Turn {
  id: number;
  question: string;
  answer?: CoachAnswer;
  error?: string;
}

function AiStatus() {
  const q = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatusDto>('/ai/status'), staleTime: 60_000 });
  const s = q.data;
  return (
    <Card className="gap-3" aria-label="How AI is used">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><ShieldCheck className="size-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight">How AI is used here</h2>
          {q.isPending ? <Skeleton className="mt-2 h-4 w-40" /> : s ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              {s.active ? <Badge variant="ok">Rewording on · {s.provider.model ?? s.provider.name}</Badge> : s.provider.configured ? <Badge variant="default">Provider ready, switched off</Badge> : <Badge variant="default">No provider configured</Badge>}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Numbers are always calculated by Spendly from your transactions. A language model never does arithmetic — if you enable one, it may only reword an answer, and its text is thrown away if it contains a figure that is not in your data.
      </p>
      {s && (
        <div className="grid gap-3 text-[13px] sm:grid-cols-2 xl:grid-cols-1">
          <div>
            <p className="font-medium">May be sent when AI is on</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{s.sends.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Never sent</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{s.neverSends.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      )}
      <Button size="sm" variant="secondary" asChild className="self-start"><Link to="/settings?tab=ai">Review AI & privacy settings</Link></Button>
    </Card>
  );
}

function Insights() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['ai', 'insights'], queryFn: () => api.get<InsightsResponseDto>('/ai/insights') });
  const refresh = useMutation({
    mutationFn: () => api.post<InsightsResponseDto>('/ai/insights/refresh'),
    onSuccess: (d) => {
      qc.setQueryData(['ai', 'insights'], d);
      toast.success('Insights refreshed from your latest transactions');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not refresh insights'),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.patch(`/ai/insights/${id}`, { status: 'dismissed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'insights'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not dismiss that insight'),
  });
  const items = q.data?.items.filter((i) => i.status === 'active') ?? [];
  const shown = all ? items : items.slice(0, 4);
  return (
    <section className="space-y-3" aria-label="Insights">
      <SectionTitle action={<Button size="xs" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} /> Refresh</Button>}>Insights from your data</SectionTitle>
      {q.isPending ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-3xl" />)}</div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : items.length === 0 ? (
        <EmptyState compact className="rounded-3xl border bg-card" icon={Sparkles} title="Nothing stands out" description="Insights appear when your spending changes in a way worth knowing about. Import more history to give them something to compare." />
      ) : (
        <>
          {q.data && q.data.potentialSavingsMonthlyPaise > 0 && (
            <div className="rounded-3xl bg-tile p-5">
              <p className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">Possible monthly saving <StatementBadge kind="estimate" /></p>
              <div className="mt-2"><Money paise={q.data.potentialSavingsMonthlyPaise} size="xl" /></div>
              <p className="mt-2 text-xs text-muted-foreground">An upper estimate from the opportunities below, based on your own recent spending. It assumes you act on all of them.</p>
            </div>
          )}
          {shown.map((i) => <InsightCard key={i.id} insight={i} onDismiss={() => dismiss.mutate(i.id)} dismissing={dismiss.isPending && dismiss.variables === i.id} />)}
          {items.length > 4 && <Button variant="secondary" size="sm" className="w-full" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${items.length}`}</Button>}
        </>
      )}
    </section>
  );
}

export default function Coach() {
  const [text, setText] = useState('');
  const [thread, setThread] = useState<Turn[]>([]);
  const counter = useRef(0);
  const threadRef = useRef(thread);
  useEffect(() => { threadRef.current = thread; }, [thread]);

  const ask = useMutation({
    mutationFn: ({ message, previousPlan }: { message: string; previousPlan?: QueryPlan }) => api.post<CoachAnswer>('/ai/chat', { message, previousPlan }),
  });

  const send = (raw: string) => {
    const message = raw.trim();
    if (message.length < 2 || ask.isPending) return;
    const id = ++counter.current;
    const previousPlan = threadRef.current.find((t) => t.answer)?.answer?.plan;
    setThread((t) => [{ id, question: message }, ...t]);
    setText('');
    ask.mutate({ message, previousPlan }, {
      onSuccess: (answer) => setThread((t) => t.map((x) => (x.id === id ? { ...x, answer } : x))),
      onError: (e) => setThread((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof ApiRequestError ? e.message : 'Something went wrong. Please try again.' } : x))),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="AI Money Coach" subtitle="Ask about your spending in plain English. Answers show their working, separate facts from estimates, and say how much data they rest on." />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="grain relative overflow-hidden rounded-[32px] border bg-card p-5 shadow-card sm:p-6" aria-label="Ask a question">
            <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(124_92_255/0.25),transparent)]" />
            <form className="relative flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
              <label htmlFor="coach-q" className="sr-only">Your question</label>
              <Input id="coach-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ask about your spending…" className="h-12 rounded-full bg-background/60 px-5 text-base" autoComplete="off" />
              <Button type="submit" size="icon-lg" aria-label="Ask" disabled={ask.isPending || text.trim().length < 2}><SendHorizontal /></Button>
            </form>
            <ul className="stagger scrollbar-none relative -mx-5 mt-3 -mb-1 grid snap-x scroll-px-5 auto-cols-max grid-flow-col grid-rows-2 gap-2 overflow-x-auto px-5 py-1 [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)] sm:m-0 sm:mt-4 sm:flex sm:flex-wrap sm:overflow-visible sm:p-0 sm:[mask-image:none]" aria-label="Suggested questions">
              {SUGGESTIONS.map((s) => (
                <li key={s} className="shrink-0 snap-start"><button type="button" onClick={() => send(s)} disabled={ask.isPending} className="rounded-full border bg-background/40 px-3.5 py-1.5 text-left text-[13px] whitespace-nowrap transition-colors sm:whitespace-normal outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{s}</button></li>
              ))}
            </ul>
          </section>

          <div className="space-y-4" aria-live="polite">
            {thread.length === 0 && (
              <EmptyState className="rounded-[32px] border border-dashed" icon={Sparkles} title="Ask your first question" description="Try “Which platform costs me the most?” or “What if I reduce online shopping by 20%?”. Follow-ups such as “and last month?” work too." compact />
            )}
            {thread.map((t) =>
              t.answer ? <AnswerCard key={t.id} answer={t.answer} onFollowUp={send} /> : t.error ? (
                <div key={t.id} role="alert" className="rounded-3xl border bg-card p-5">
                  <p className="text-[13px] text-muted-foreground">{t.question}</p>
                  <p className="mt-2 text-sm text-bad">{t.error}</p>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => send(t.question)}>Try again</Button>
                </div>
              ) : (
                <div key={t.id} className="rounded-[32px] border bg-card p-5 sm:p-7" aria-busy="true">
                  <p className="text-[13px] text-muted-foreground">{t.question}</p>
                  <Skeleton className="mt-4 h-8 w-3/4" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                  <p className="sr-only">Looking at your transactions…</p>
                </div>
              ),
            )}
          </div>
        </div>

        <aside className="space-y-5" aria-label="Insights and AI settings">
          <Insights />
          <AiStatus />
        </aside>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Download, FileText, FlaskConical } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ReportDto } from '@spendly/shared';
import { ErrorState, PageHeader } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { formatDate, inr } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ReportType {
  type: string;
  title: string;
  description: string;
}
type Column = ReportDto['sections'][number]['columns'][number];

function cell(value: string | number | null | undefined, format: Column['format']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (format === 'money') return inr(value);
    if (format === 'percent') return `${value < 0 ? '−' : ''}${Math.abs(Math.round(value * 10) / 10)}%`;
    return value.toLocaleString('en-IN');
  }
  if (format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return DateTime.fromISO(value).toFormat('d LLL yyyy');
  return value;
}

export default function Reports() {
  const { prefs } = useSession();
  const { rangeParams } = useFilters();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: () => api.get<ReportType[]>('/reports/types'), staleTime: Infinity });
  const type = params.get('type') ?? 'monthly-spending';
  const report = useQuery({ queryKey: ['reports', 'one', type, rangeParams], queryFn: () => api.get<ReportDto>(`/reports/${type}`, { ...rangeParams, format: 'json' }), placeholderData: keepPreviousData });
  const r = report.data;

  const download = async (format: 'csv' | 'pdf') => {
    setBusy(format);
    try {
      await api.download(`/reports/${type}`, { ...rangeParams, format }, `spendly-${type}.${format}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Clean summaries of your spending to read, save or share. The period follows the date range at the top."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => void download('csv')} disabled={busy !== null || !r}><Download /> {busy === 'csv' ? 'Preparing…' : 'CSV'}</Button>
            <Button size="sm" onClick={() => void download('pdf')} disabled={busy !== null || !r}><FileText /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}</Button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Report types" className="-mx-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-[calc(var(--banner-h,0px)+1rem)] lg:mx-0 lg:self-start lg:overflow-visible lg:px-0 lg:pb-0">
          <ul className="flex gap-2 lg:flex-col">
            {(types.data ?? []).map((t) => {
              const on = t.type === type;
              return (
                <li key={t.type} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('type', t.type); return n; }, { replace: true })}
                    className={cn('w-full rounded-3xl border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-transparent bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}
                  >
                    <span className="block text-sm font-medium whitespace-nowrap lg:whitespace-normal">{t.title}</span>
                    <span className={cn('mt-0.5 hidden text-xs lg:block', on ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{t.description}</span>
                  </button>
                </li>
              );
            })}
            {types.isPending && [0, 1, 2, 3].map((i) => <li key={i}><Skeleton className="h-16 w-40 rounded-3xl lg:w-full" /></li>)}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4" aria-busy={report.isFetching || undefined}>
          {report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : !r ? (
            <Skeleton className="h-[28rem] rounded-[32px]" />
          ) : (
            <div className={cn('space-y-4 transition-opacity', report.isFetching && 'opacity-60')}>
              <section className="grain relative overflow-hidden rounded-[32px] border bg-card p-6 shadow-card sm:p-8" aria-label="Report summary">
                <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(124_92_255/0.2),transparent)]" />
                <div className="relative">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {r.range.label}
                    {r.isDemo && <Badge variant="warn" className="normal-case tracking-normal"><FlaskConical aria-hidden /> Demo data</Badge>}
                  </p>
                  <h2 className="type-headline mt-2 text-[28px] leading-tight sm:text-[34px]">{r.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{r.subtitle}</p>
                  {r.summary.length > 0 && (
                    <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {r.summary.map((s) => (
                        <div key={s.label} className="rounded-2xl bg-muted/60 px-4 py-3">
                          <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{s.label}</dt>
                          <dd className="mt-1 text-lg leading-tight font-semibold tracking-tight tnum">
                            {s.value}
                            {s.delta && <span className={`ml-2 text-xs font-medium ${s.tone === 'good' ? 'text-ok' : s.tone === 'bad' ? 'text-warn' : 'text-muted-foreground'}`}>{s.delta}</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-5 text-xs text-muted-foreground">Generated {formatDate(r.generatedAt, prefs.timezone, 'long')} in {r.timezone}. Amounts are net of refunds; transfers and pending payments are excluded.</p>
                </div>
              </section>

              {r.sections.map((sec) => (
                <Card key={sec.title} className="gap-3">
                  <div>
                    <h3 className="text-[15px] font-semibold tracking-tight">{sec.title}</h3>
                    {sec.note && <p className="mt-1 text-[13px] text-muted-foreground">{sec.note}</p>}
                  </div>
                  {sec.rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing to show for this period.</p> : sec.columns.length === 1 ? (
                    <ul className="space-y-2.5">{sec.rows.map((row, i) => <li key={i} className="text-[14px] leading-relaxed">{cell(row[sec.columns[0]!.key], sec.columns[0]!.format)}</li>)}</ul>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border" tabIndex={0} role="region" aria-label={`${sec.title} table, scrolls sideways`}>
                      <table className="w-full min-w-max text-[13px]">
                        <thead className="bg-muted/60">
                          <tr>{sec.columns.map((c) => <th key={c.key} scope="col" className={cn('px-3 py-2.5 font-medium whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr>
                        </thead>
                        <tbody>
                          {sec.rows.map((row, i) => (
                            <tr key={i} className="border-t">
                              {sec.columns.map((c, ci) => <td key={c.key} className={cn('px-3 py-2.5', c.align === 'right' ? 'text-right tnum' : 'text-left', ci === 0 && 'font-medium')}>{cell(row[c.key], c.format)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, Download, Info, RotateCcw, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ImportJobDto } from '@spendly/shared';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/common/states';
import { MappingStep } from '@/components/imports/mapping-step';
import { ReviewStep } from '@/components/imports/review-step';
import { ImportStatusBadge, KIND_LABEL, fileSize, isRunning } from '@/components/imports/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { api } from '@/lib/api';
import { formatDate, plural } from '@/lib/format';

const stageOf = (s: ImportJobDto['status']) => (s === 'needs_mapping' || s === 'uploaded' ? 'map' : isRunning(s) ? 'run' : s === 'ready_for_review' ? 'review' : 'done');

const PHASE: Record<string, string> = {
  uploaded: 'Uploaded',
  queued: 'Waiting to start…',
  reading: 'Reading every row…',
  classifying: 'Recognising platforms and categories, and checking for duplicates…',
  importing: 'Adding transactions to your ledger…',
  review: 'Preparing the review…',
  done: 'Finishing up…',
};

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-3xl bg-tile p-4 text-[13px]" aria-label="Notes about this file">
      {notes.map((n, i) => <li key={i} className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{n}</li>)}
    </ul>
  );
}

function ProgressStep({ job }: { job: ImportJobDto }) {
  const importing = job.status === 'importing';
  return (
    <Card className="items-center gap-5 py-10 text-center" aria-live="polite">
      <div className="w-full max-w-sm">
        <p className="type-headline text-[24px] leading-tight">{importing ? 'Importing…' : 'Reading your file…'}</p>
        <Progress value={job.progress.percent} className="mt-6 h-2.5" label="Progress" />
        <p className="mt-3 text-sm text-muted-foreground tnum">
          {PHASE[job.progress.phase] ?? 'Working…'}
          {job.progress.total > 0 && <> {job.progress.processed.toLocaleString('en-IN')} of {job.progress.total.toLocaleString('en-IN')} rows.</>}
        </p>
      </div>
      <p className="max-w-sm text-xs text-muted-foreground">This runs in the background. You can leave this page; the import carries on and you can come back from Import & Sync.</p>
    </Card>
  );
}

function ResultStep({ job }: { job: ImportJobDto }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const [undo, setUndo] = useState(false);
  const s = job.stats;
  const failed = job.status === 'failed';
  const refresh = (j: ImportJobDto) => {
    qc.setQueryData(['imports', 'one', job.id], j);
    void qc.invalidateQueries({ queryKey: ['imports'] });
  };
  const retry = useMutation({ mutationFn: () => api.post<ImportJobDto>(`/imports/${job.id}/retry`), onSuccess: (j) => { refresh(j); toast.success('Trying again'); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not retry') });
  const rollback = useMutation({
    mutationFn: () => api.post<ImportJobDto>(`/imports/${job.id}/rollback`),
    onSuccess: async (j) => {
      refresh(j);
      await invalidate();
      setUndo(false);
      toast.success('Undoing the import…');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not undo the import'),
  });
  const skipped = Math.max(0, s.totalRows - s.imported - s.failedToImport - s.invalid);
  const download = () => api.download(`/imports/${job.id}/errors.csv`, undefined, 'import-errors.csv').catch((e) => toast.error(e instanceof Error ? e.message : 'Download failed'));

  return (
    <div className="space-y-4">
      <section className="grain relative overflow-hidden rounded-[32px] border bg-card p-6 shadow-card sm:p-8" aria-label="Result">
        <div aria-hidden className="pointer-events-none absolute -top-20 -left-10 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(124_92_255/0.22),transparent)]" />
        <div className="relative">
          <span className={failed ? 'grid size-12 place-items-center rounded-full bg-bad-soft text-bad' : s.failedToImport > 0 ? 'grid size-12 place-items-center rounded-full bg-warn-soft text-warn' : 'grid size-12 place-items-center rounded-full bg-ok-soft text-ok'}>
            {failed || s.failedToImport > 0 ? <TriangleAlert className="size-6" aria-hidden /> : <CircleCheck className="size-6" aria-hidden />}
          </span>
          <h2 className="type-headline mt-4 text-[28px] leading-tight sm:text-[32px]">{failed ? 'This import did not finish' : `${plural(s.imported, 'transaction')} imported`}</h2>
          {failed && job.error && <p className="mt-2 max-w-prose text-sm text-bad">{job.error}</p>}
          {!failed && <p className="mt-2 max-w-prose text-sm text-muted-foreground">They are in your ledger now and included in every chart and total.</p>}
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Imported', s.imported],
              ['Skipped by you', skipped],
              ['Could not be read', s.invalid],
              ['Failed to save', s.failedToImport],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-2xl bg-muted/60 px-4 py-3">
                <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight tnum">{(n as number).toLocaleString('en-IN')}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            {s.imported > 0 && <Button asChild><Link to={`/transactions?importJob=${job.id}`}>View imported transactions</Link></Button>}
            {s.invalid + s.failedToImport > 0 && <Button variant="secondary" onClick={() => void download()}><Download /> Error report (CSV)</Button>}
            {job.canRetry && <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw /> {failed ? 'Try again' : 'Retry the rows that failed'}</Button>}
            {job.canRollback && <Button variant="ghost" onClick={() => setUndo(true)}><Undo2 /> Undo this import</Button>}
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={undo}
        onOpenChange={setUndo}
        title="Undo this import?"
        description={`This removes the ${plural(s.imported, 'transaction')} it added, including any you edited since, and returns the file to review so you can choose again. Other transactions are not touched.`}
        confirmLabel="Undo import"
        destructive
        pending={rollback.isPending}
        onConfirm={() => rollback.mutate()}
      />
    </div>
  );
}

export default function ImportJob() {
  const { id = '' } = useParams();
  const { prefs } = useSession();
  const navigate = useNavigate();
  const invalidate = useInvalidateMoney();
  const q = useQuery({
    queryKey: ['imports', 'one', id],
    queryFn: () => api.get<ImportJobDto>(`/imports/${id}`),
    refetchInterval: (query) => (isRunning(query.state.data?.status) ? 1500 : false),
  });
  const job = q.data;
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const del = useMutation({
    mutationFn: () => api.delete<{ transactionsKept: number }>(`/imports/${id}`),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['imports'] });
      toast.success(r.transactionsKept ? `Import removed — its ${plural(r.transactionsKept, 'transaction')} stay in your ledger` : 'Import removed');
      navigate('/import', { replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete that import'),
  });

  // when an import finishes, every total on screen may have changed
  const previous = useRef(job?.status);
  useEffect(() => {
    if (previous.current && previous.current !== job?.status && job && (job.status === 'completed' || job.status === 'completed_with_errors')) void invalidate();
    previous.current = job?.status;
  }, [job, invalidate]);

  // moving from mapping to progress to review should start each step at the top
  const stage = !job ? 'loading' : stageOf(job.status);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  if (q.isError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground"><Link to="/import"><ArrowLeft /> Import & Sync</Link></Button>
        <ErrorState error={q.error} onRetry={() => navigate(0)} />
      </div>
    );
  }

  const status = job?.status;
  const step =
    !job ? null
    : status === 'needs_mapping' || status === 'uploaded' ? <MappingStep key={`${job.id}-${job.updatedAt}`} job={job} />
    : isRunning(status) ? <ProgressStep job={job} />
    : status === 'ready_for_review' ? <ReviewStep job={job} />
    : <ResultStep job={job} />;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground"><Link to="/import"><ArrowLeft /> Import & Sync</Link></Button>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {job ? <h1 className="type-title truncate text-[27px] leading-[1.08] sm:text-[33px]">{job.filename}</h1> : <Skeleton className="h-9 w-72" />}
          {job ? <p className="mt-1.5 text-sm text-muted-foreground">{KIND_LABEL[job.kind]} · {fileSize(job.sizeBytes)} · uploaded {formatDate(job.createdAt, prefs.timezone, 'long')}</p> : <Skeleton className="mt-2 h-4 w-56" />}
        </div>
        {job && (
          <div className="flex items-center gap-2">
            <ImportStatusBadge status={job.status} />
            <Button size="icon-sm" variant="ghost" aria-label={`Delete import ${job.filename}`} disabled={isRunning(job.status)} onClick={() => setDeleting(true)}><Trash2 /></Button>
          </div>
        )}
      </header>
      {job && status !== 'needs_mapping' && status !== 'uploaded' && <Notes notes={job.notes} />}
      {step ?? <Skeleton className="h-96 rounded-[32px]" />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Remove this import?"
        description="The uploaded file and its review list are deleted. Transactions it already added stay in your ledger — undo the import first if you want them gone."
        confirmLabel="Remove import"
        destructive
        pending={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, FileUp, Image as ImageIcon, Mail, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ImportJobDto, IntegrationDto } from '@spendly/shared';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, ErrorState, PageHeader, SectionTitle } from '@/components/common/states';
import { ImportStatusBadge, KIND_LABEL, fileSize, isRunning } from '@/components/imports/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { ApiRequestError, api } from '@/lib/api';
import { formatDate, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACCEPT = '.csv,.xlsx,.pdf,.eml,.png,.jpg,.jpeg,.webp';
const KINDS = [
  { value: 'auto', label: 'Let Spendly work it out' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'credit_card_statement', label: 'Credit card statement' },
  { value: 'upi_export', label: 'UPI transaction export' },
  { value: 'generic', label: 'Other spreadsheet' },
  { value: 'receipt', label: 'Receipt (photo or PDF)' },
] as const;

function fileIcon(t: ImportJobDto['fileType']) {
  return t === 'eml' ? Mail : t === 'image' ? ImageIcon : t === 'pdf' ? FileText : FileSpreadsheet;
}

function downloadTemplate() {
  const csv = 'Date,Description,Amount\n05/10/2026,Zomato order,-452.00\n06/10/2026,Salary credit,95000.00\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'spendly-template.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function UploadCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // a guide in Settings links here with the file type already chosen (?kind=receipt)
  const [params] = useSearchParams();
  const [kind, setKind] = useState<string>(() => KINDS.find((k) => k.value === params.get('kind'))?.value ?? 'auto');
  const [over, setOver] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append('file', file);
      if (kind !== 'auto') f.append('kind', kind);
      return api.upload<ImportJobDto>('/imports', f);
    },
    onSuccess: async (job) => {
      await qc.invalidateQueries({ queryKey: ['imports'] });
      navigate(`/import/${job.id}`);
    },
  });
  const pick = (file: File | undefined) => {
    if (file) upload.mutate(file);
    if (input.current) input.current.value = '';
  };
  const error = upload.error instanceof ApiRequestError ? upload.error.message : upload.error ? 'The upload failed. Please try again.' : null;

  return (
    <section
      aria-label="Upload a file"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      className={cn('grain relative overflow-hidden rounded-[32px] border-2 border-dashed bg-card p-6 text-center shadow-card transition-colors sm:p-10', over ? 'border-foreground/60 bg-accent' : 'border-border')}
    >
      <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 size-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(124_92_255/0.2),transparent)]" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <span className="grid size-16 place-items-center rounded-full bg-muted"><Upload className="size-7" strokeWidth={1.75} aria-hidden /></span>
        <div>
          <h2 className="type-headline text-[24px] leading-tight">{over ? 'Drop it here' : 'Bring in a statement'}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">CSV, Excel, text-based PDF statements, receipt emails (.eml) or receipt photos. You will see every row and decide what is saved.</p>
        </div>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a file to import" onChange={(e) => pick(e.target.files?.[0])} tabIndex={-1} />
        <div className="flex w-full flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => input.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Uploading…' : <><FileUp /> Choose a file</>}</Button>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-12 w-auto min-w-52 rounded-full bg-background/60" aria-label="What kind of file is it?"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {error && <p role="alert" className="w-full rounded-2xl bg-bad-soft px-4 py-3 text-left text-sm text-bad">{error}</p>}
        <p className="flex items-start gap-2 text-left text-xs text-muted-foreground"><ShieldCheck className="mt-px size-4 shrink-0" aria-hidden /> Your file is stored privately for your account only, and you can delete it from the import history at any time.</p>
      </div>
    </section>
  );
}

function History() {
  const { prefs } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['imports', 'list'], queryFn: () => api.get<ImportJobDto[]>('/imports'), refetchInterval: (query) => (query.state.data?.some((j) => isRunning(j.status)) ? 2000 : false) });
  const [deleting, setDeleting] = useState<ImportJobDto | null>(null);
  const del = useMutation({
    mutationFn: (j: ImportJobDto) => api.delete<{ transactionsKept: number }>(`/imports/${j.id}`),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['imports'] });
      toast.success(r.transactionsKept ? `Import removed — its ${plural(r.transactionsKept, 'transaction')} stay in your ledger` : 'Import removed');
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete that import'),
  });
  return (
    <section className="space-y-3" aria-label="Import history">
      <SectionTitle>Recent imports</SectionTitle>
      {q.isPending ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-3xl" />)}</div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : q.data.length === 0 ? (
        <EmptyState compact className="rounded-3xl border bg-card" icon={FileUp} title="No imports yet" description="Your uploaded files and what came of them will be listed here." />
      ) : (
        <ul className="stagger space-y-2">
          {q.data.map((j) => {
            const Icon = fileIcon(j.fileType);
            return (
              <li key={j.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-3xl border bg-card p-4 shadow-card transition-colors hover:bg-accent/40">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted"><Icon className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1 basis-40">
                  <Link to={`/import/${j.id}`} className="block truncate font-medium outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-ring">{j.filename}</Link>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground tnum">
                    {KIND_LABEL[j.kind]} · {fileSize(j.sizeBytes)} · {formatDate(j.createdAt, prefs.timezone, 'long')}
                    {j.stats.imported > 0 && ` · ${plural(j.stats.imported, 'transaction')} imported`}
                  </p>
                  {isRunning(j.status) && <Progress value={j.progress.percent} className="mt-2 h-1.5" label={`${j.filename} progress`} />}
                </div>
                <ImportStatusBadge status={j.status} />
                <Button size="icon-sm" variant="ghost" className="relative z-10" aria-label={`Delete import ${j.filename}`} disabled={isRunning(j.status)} onClick={() => setDeleting(j)}><Trash2 /></Button>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title="Remove this import?" description="The uploaded file and its review list are deleted. Transactions it already added stay in your ledger — undo the import first if you want them gone." confirmLabel="Remove import" destructive pending={del.isPending} onConfirm={() => deleting && del.mutate(deleting)} />
    </section>
  );
}

const STATUS_TONE = { available: 'ok', not_configured: 'warn', unavailable: 'default' } as const;

function Integrations() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<IntegrationDto[]>('/integrations'), staleTime: 5 * 60_000 });
  return (
    <section className="space-y-3" aria-label="Sync options">
      <SectionTitle>What works today</SectionTitle>
      {q.isPending ? <Skeleton className="h-64 rounded-3xl" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : (
        <ul className="space-y-2">
          {q.data.map((i) => (
            <li key={i.id} className="rounded-3xl border bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{i.name}</p>
                <Badge variant={STATUS_TONE[i.status]}>{i.statusLabel}</Badge>
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{i.description}</p>
              {i.requires.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Needs: {i.requires.join('; ')}.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ImportCenter() {
  return (
    <div className="space-y-6">
      <PageHeader title="Import & Sync" subtitle="Spendly never logs in to your food, entertainment or any other app. You export a statement or receipt yourself, upload it here, and check it before anything is saved." actions={<Button size="sm" variant="secondary" onClick={downloadTemplate}><Download /> CSV template</Button>} />
      <UploadCard />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <History />
        <div className="space-y-6">
          <Integrations />
          <Card className="gap-3" aria-label="Getting your statements">
            <h2 className="text-[15px] font-semibold tracking-tight">Getting your data out</h2>
            <ul className="list-disc space-y-2 pl-5 text-[13px] text-muted-foreground">
              <li><strong className="font-medium text-foreground">Bank or card:</strong> in net banking or the bank’s app, open Statements and download CSV, Excel or a text PDF. Pick the longest range available.</li>
              <li><strong className="font-medium text-foreground">UPI apps:</strong> many let you export transaction history from the history or profile screen. Bank statements also list every UPI payment.</li>
              <li><strong className="font-medium text-foreground">Receipts by email:</strong> open the email and save it as an .eml file, then upload it.</li>
              <li><strong className="font-medium text-foreground">Password-protected files:</strong> remove the password in your bank’s viewer first; Spendly cannot open locked files.</li>
            </ul>
            <p className="rounded-2xl bg-warn-soft px-4 py-3 text-[13px] text-warn">Never share your bank password, card PIN, UPI PIN or an OTP with anyone — including this app. Spendly will never ask for them.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

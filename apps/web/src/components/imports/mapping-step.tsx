import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type ImportJobDto, type ImportMapping } from '@spendly/shared';
import { Field } from '@/components/common/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiRequestError, api } from '@/lib/api';

type Columns = ImportMapping['columns'];
type FieldKey = keyof Columns;

const FIELDS: Array<{ key: FieldKey; label: string; hint?: string; required?: boolean }> = [
  { key: 'date', label: 'Date', required: true },
  { key: 'time', label: 'Time of day', hint: 'Only if the time is in its own column.' },
  { key: 'description', label: 'Description or narration' },
  { key: 'merchant', label: 'Merchant or payee' },
  { key: 'amount', label: 'Amount', hint: 'Use this when money in and out share one column.' },
  { key: 'debit', label: 'Debit (money out)' },
  { key: 'credit', label: 'Credit (money in)' },
  { key: 'drcr', label: 'Debit / credit marker', hint: 'A column saying DR or CR.' },
  { key: 'reference', label: 'Reference or UTR', hint: 'Helps detect duplicates.' },
  { key: 'category', label: 'Category' },
  { key: 'paymentMethod', label: 'Payment method' },
];
const ROLE_LABEL: Record<FieldKey, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label.split(' ')[0]!])) as Record<FieldKey, string>;
const NONE = '__none';

const FALLBACK: ImportMapping = { kind: 'generic', headerRow: 0, columns: { date: '' }, dateOrder: 'dmy', amountSign: 'negative_is_expense', defaultPaymentMethod: 'bank_transfer' };

interface Preview {
  sheet: string | null;
  headerRow: number;
  columns: string[];
  sampleRows: string[][];
  suggestedMapping: ImportMapping;
  notes: string[];
}

/**
 * Tells Spendly which column is which. The suggestion is filled in from the header names and a
 * sample of the values; everything stays editable, and a sample of real rows is shown underneath.
 */
export function MappingStep({ job }: { job: ImportJobDto }) {
  const qc = useQueryClient();
  const initial = job.mapping ?? job.suggestedMapping ?? FALLBACK;
  const [m, setM] = useState<ImportMapping>(initial);
  const [view, setView] = useState<{ sheet: string | null; headerRow: number; columns: string[]; sampleRows: string[][]; notes: string[] }>({
    sheet: initial.sheet ?? job.sheets[0] ?? null,
    headerRow: job.headerRow,
    columns: job.columns,
    sampleRows: job.sampleRows,
    notes: job.notes,
  });
  const [suggested, setSuggested] = useState<ImportMapping>(job.suggestedMapping ?? initial);

  const preview = useMutation({
    mutationFn: (v: { sheet?: string | null; headerRow: number }) => api.get<Preview>(`/imports/${job.id}/preview`, { sheet: v.sheet ?? undefined, headerRow: v.headerRow }),
    onSuccess: (p) => {
      setView({ sheet: p.sheet, headerRow: p.headerRow, columns: p.columns, sampleRows: p.sampleRows, notes: p.notes });
      setSuggested(p.suggestedMapping);
      setM({ ...p.suggestedMapping, kind: m.kind, defaultPaymentMethod: m.defaultPaymentMethod });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not re-read the file'),
  });
  const save = useMutation({
    mutationFn: () => api.put<ImportJobDto>(`/imports/${job.id}/mapping`, { ...m, sheet: view.sheet ?? undefined, headerRow: view.headerRow }),
    onSuccess: (j) => {
      qc.setQueryData(['imports', 'one', job.id], j);
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  const setCol = (key: FieldKey, value: string) => setM((cur) => ({ ...cur, columns: { ...cur.columns, [key]: value === NONE ? null : value } as Columns }));
  const roleByColumn = new Map<string, FieldKey[]>();
  for (const f of FIELDS) {
    const col = m.columns[f.key];
    if (col) roleByColumn.set(col, [...(roleByColumn.get(col) ?? []), f.key]);
  }
  const problems: string[] = [];
  if (!m.columns.date) problems.push('Choose the date column.');
  if (!m.columns.amount && !m.columns.debit && !m.columns.credit) problems.push('Choose an amount column, or debit and credit columns.');
  const usesSingleAmount = Boolean(m.columns.amount) && !m.columns.debit && !m.columns.credit;
  const error = save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Could not save the mapping.' : null;
  const headers = view.columns;

  return (
    <div className="space-y-4">
      {view.notes.length > 0 && (
        <ul className="space-y-1.5 rounded-3xl bg-tile p-4 text-[13px]" aria-label="Notes about this file">
          {view.notes.map((n, i) => <li key={i} className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{n}</li>)}
        </ul>
      )}

      <Card className="gap-5">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Where is each piece of information?</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Spendly guessed from your column names{job.detectedFormat ? ` (it looks like ${job.detectedFormat})` : ''}. Check the guess against the sample below and correct anything that is off.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {job.sheets.length > 1 && (
            <Field label="Sheet">
              <Select value={view.sheet ?? undefined} onValueChange={(v) => preview.mutate({ sheet: v, headerRow: 0 })}>
                <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>{job.sheets.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Column names are on row" hint="Rows above it (bank logos, account details) are ignored." htmlFor="m-header">
            <Input id="m-header" type="number" inputMode="numeric" min={1} max={201} value={view.headerRow + 1} onChange={(e) => { const n = Math.max(1, Math.min(201, Number(e.target.value) || 1)) - 1; setView((v) => ({ ...v, headerRow: n })); }} onBlur={() => preview.mutate({ sheet: view.sheet, headerRow: view.headerRow })} />
          </Field>
          <Field label="Kind of statement">
            <Select value={m.kind} onValueChange={(v) => setM({ ...m, kind: v as ImportMapping['kind'] })}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Other spreadsheet</SelectItem>
                <SelectItem value="bank_statement">Bank statement</SelectItem>
                <SelectItem value="credit_card_statement">Credit card statement</SelectItem>
                <SelectItem value="upi_export">UPI export</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
              <Select value={m.columns[f.key] || NONE} onValueChange={(v) => setCol(f.key, v)}>
                <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>Not in this file</SelectItem>
                  {headers.filter(Boolean).map((h, i) => <SelectItem key={`${h}-${i}`} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Dates are written as">
            <Select value={m.dateOrder} onValueChange={(v) => setM({ ...m, dateOrder: v as ImportMapping['dateOrder'] })}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dmy">Day / month / year</SelectItem>
                <SelectItem value="mdy">Month / day / year</SelectItem>
                <SelectItem value="ymd">Year-month-day</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amounts" hint={usesSingleAmount ? undefined : 'Only used with a single amount column.'}>
            <Select value={m.amountSign} onValueChange={(v) => setM({ ...m, amountSign: v as ImportMapping['amountSign'] })} disabled={!usesSingleAmount}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="negative_is_expense">Negative means spending</SelectItem>
                <SelectItem value="positive_is_expense">Positive means spending</SelectItem>
                <SelectItem value="all_expenses">Every row is spending</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Paid with (when not stated)">
            <Select value={m.defaultPaymentMethod} onValueChange={(v) => setM({ ...m, defaultPaymentMethod: v as ImportMapping['defaultPaymentMethod'] })}>
              <SelectTrigger className="h-11 w-full rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((p) => <SelectItem key={p} value={p}>{PAYMENT_METHOD_LABELS[p]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="gap-3" aria-label="Sample of your file">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">First rows of your file</h2>
          <Button size="xs" variant="ghost" onClick={() => setM({ ...suggested })}><RotateCcw /> Reset to Spendly’s guess</Button>
        </div>
        <div className="overflow-x-auto rounded-2xl border" tabIndex={0} aria-label="Sample rows, scrolls sideways">
          <table className="w-full min-w-max text-left text-[13px]">
            <thead className="bg-muted/60">
              <tr>
                {headers.map((h, i) => (
                  <th key={`${h}-${i}`} scope="col" className="px-3 py-2 align-bottom font-medium whitespace-nowrap">
                    <span className="block">{h || <span className="text-muted-foreground">(blank)</span>}</span>
                    <span className="mt-1 flex gap-1">{(roleByColumn.get(h) ?? []).map((r) => <Badge key={r} variant="solid" className="px-1.5 py-0 text-[10px]">{ROLE_LABEL[r]}</Badge>)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.sampleRows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {headers.map((_, ci) => <td key={ci} className="max-w-56 truncate px-3 py-2 tnum">{r[ci] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(problems.length > 0 || error) && (
        <ul role="alert" className="space-y-1 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{[...problems, ...(error ? [error] : [])].map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="lg" disabled={problems.length > 0 || save.isPending || preview.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Starting…' : 'Read the file with these settings'}</Button>
      </div>
    </div>
  );
}

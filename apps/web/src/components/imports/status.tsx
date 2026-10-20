import { CircleAlert, CircleCheck, CircleDashed, Columns3, Eye, Loader, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ImportJobDto, ImportStatus } from '@spendly/shared';
import { Badge } from '@/components/ui/badge';

export const isRunning = (s: ImportStatus | undefined) => s === 'queued' || s === 'processing' || s === 'importing';

export const KIND_LABEL: Record<ImportJobDto['kind'], string> = {
  generic: 'Spreadsheet or CSV',
  bank_statement: 'Bank statement',
  credit_card_statement: 'Credit card statement',
  upi_export: 'UPI export',
  receipt: 'Receipt',
  email_receipt: 'Email receipt',
};

const STATUS: Record<ImportStatus, { label: string; variant: 'default' | 'ok' | 'warn' | 'bad'; icon: LucideIcon; spin?: boolean }> = {
  uploaded: { label: 'Uploaded', variant: 'default', icon: CircleDashed },
  needs_mapping: { label: 'Match the columns', variant: 'warn', icon: Columns3 },
  queued: { label: 'Waiting to start', variant: 'default', icon: Loader, spin: true },
  processing: { label: 'Reading the file', variant: 'default', icon: Loader, spin: true },
  ready_for_review: { label: 'Ready to review', variant: 'warn', icon: Eye },
  importing: { label: 'Importing', variant: 'default', icon: Loader, spin: true },
  completed: { label: 'Imported', variant: 'ok', icon: CircleCheck },
  completed_with_errors: { label: 'Imported · some rows had problems', variant: 'warn', icon: TriangleAlert },
  failed: { label: 'Failed', variant: 'bad', icon: CircleAlert },
  cancelled: { label: 'Cancelled', variant: 'default', icon: CircleDashed },
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      <Icon aria-hidden className={s.spin ? 'animate-spin' : undefined} />
      {s.label}
    </Badge>
  );
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

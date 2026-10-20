import { Schema, model, type Types } from 'mongoose';
import type { ImportStatus } from '@spendly/shared';

export interface ImportJobDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  filename: string;
  fileType: 'csv' | 'xlsx' | 'pdf' | 'eml' | 'image';
  sizeBytes: number;
  fileHash: string;
  storageKey: string;
  kind: 'generic' | 'bank_statement' | 'credit_card_statement' | 'upi_export' | 'receipt' | 'email_receipt';
  status: ImportStatus;
  /** Background work queued for this job; claimed atomically by a worker. */
  queue: { task: 'process' | 'import' | 'rollback' | null; state: 'idle' | 'queued' | 'running'; lockedAt: Date | null; attempts: number };
  sheets: string[];
  sheet: string | null;
  headerRow: number;
  columns: string[];
  sampleRows: string[][];
  detectedFormat: string | null;
  suggestedMapping: Record<string, unknown> | null;
  mapping: Record<string, unknown> | null;
  stats: {
    totalRows: number;
    valid: number;
    invalid: number;
    duplicates: number;
    uncertain: number;
    imported: number;
    failedToImport: number;
  };
  progress: { phase: string; processed: number; total: number };
  /** Index of the next row/record to handle, so a retry resumes instead of restarting. */
  cursor: number;
  error: string | null;
  notes: string[];
  isDemo: boolean;
  /** Create learned rules from uncertain matches the user accepted. */
  learn: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const importJobSchema = new Schema<ImportJobDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true, maxlength: 200 },
    fileType: { type: String, enum: ['csv', 'xlsx', 'pdf', 'eml', 'image'], required: true },
    sizeBytes: { type: Number, required: true },
    fileHash: { type: String, required: true },
    storageKey: { type: String, required: true },
    kind: { type: String, default: 'generic' },
    status: { type: String, default: 'uploaded' },
    queue: {
      task: { type: String, default: null },
      state: { type: String, enum: ['idle', 'queued', 'running'], default: 'idle' },
      lockedAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
    },
    sheets: { type: [String], default: [] },
    sheet: { type: String, default: null },
    headerRow: { type: Number, default: 0 },
    columns: { type: [String], default: [] },
    sampleRows: { type: [[String]], default: [] },
    detectedFormat: { type: String, default: null },
    suggestedMapping: { type: Schema.Types.Mixed, default: null },
    mapping: { type: Schema.Types.Mixed, default: null },
    stats: {
      totalRows: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      invalid: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      uncertain: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      failedToImport: { type: Number, default: 0 },
    },
    progress: {
      phase: { type: String, default: 'uploaded' },
      processed: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    cursor: { type: Number, default: 0 },
    error: { type: String, default: null, maxlength: 1000 },
    notes: { type: [String], default: [] },
    isDemo: { type: Boolean, default: false },
    learn: { type: Boolean, default: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
importJobSchema.index({ userId: 1, createdAt: -1 });
importJobSchema.index({ 'queue.state': 1, 'queue.lockedAt': 1 });
importJobSchema.index({ userId: 1, fileHash: 1 });

export const ImportJob = model<ImportJobDoc>('ImportJob', importJobSchema);

export interface ImportRecordDoc {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  userId: Types.ObjectId;
  rowNumber: number;
  status: 'valid' | 'invalid' | 'duplicate' | 'uncertain';
  decision: 'accepted' | 'rejected' | 'pending';
  raw: Record<string, string>;
  draft: Record<string, unknown> | null;
  classification: { source: string; confidence: number; reason: string; needsReview: boolean; ruleId: string | null } | null;
  issues: Array<{ code: string; message: string; field?: string }>;
  duplicateOf: { id: Types.ObjectId; merchantName: string; date: Date; amountPaise: number } | null;
  merchantKey: string | null;
  importedTransactionId: Types.ObjectId | null;
  importError: string | null;
  expiresAt: Date | null;
}

const importRecordSchema = new Schema<ImportRecordDoc>({
  jobId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  rowNumber: { type: Number, required: true },
  status: { type: String, enum: ['valid', 'invalid', 'duplicate', 'uncertain'], required: true },
  decision: { type: String, enum: ['accepted', 'rejected', 'pending'], default: 'pending' },
  raw: { type: Schema.Types.Mixed, default: {} },
  draft: { type: Schema.Types.Mixed, default: null },
  classification: { type: Schema.Types.Mixed, default: null },
  issues: { type: [new Schema({ code: String, message: String, field: String }, { _id: false })], default: [] },
  duplicateOf: {
    type: new Schema({ id: Schema.Types.ObjectId, merchantName: String, date: Date, amountPaise: Number }, { _id: false }),
    default: null,
  },
  merchantKey: { type: String, default: null },
  importedTransactionId: { type: Schema.Types.ObjectId, default: null },
  importError: { type: String, default: null },
  expiresAt: { type: Date, default: null },
});
importRecordSchema.index({ jobId: 1, rowNumber: 1 }, { unique: true });
importRecordSchema.index({ jobId: 1, status: 1, decision: 1 });
importRecordSchema.index({ userId: 1 });
importRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ImportRecord = model<ImportRecordDoc>('ImportRecord', importRecordSchema);

export interface ImportErrorDoc {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  userId: Types.ObjectId;
  rowNumber: number;
  code: string;
  message: string;
  field: string | null;
  raw: Record<string, string>;
  createdAt: Date;
}

const importErrorSchema = new Schema<ImportErrorDoc>(
  {
    jobId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    rowNumber: { type: Number, required: true },
    code: { type: String, required: true },
    message: { type: String, required: true, maxlength: 500 },
    field: { type: String, default: null },
    raw: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
importErrorSchema.index({ jobId: 1, rowNumber: 1 });
importErrorSchema.index({ userId: 1 });

export const ImportError = model<ImportErrorDoc>('ImportError', importErrorSchema);

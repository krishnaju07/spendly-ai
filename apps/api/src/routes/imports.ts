import { once } from 'node:events';
import { Router } from 'express';
import multer from 'multer';
import type { HydratedDocument, QueryFilter, Types } from 'mongoose';
import { z } from 'zod';
import {
  IMPORT_KINDS,
  detectDateOrder,
  importBulkDecisionSchema,
  importConfirmSchema,
  importMappingSchema,
  importRecordPatchSchema,
  recognize,
  type ImportJobDto,
  type ImportMapping,
  type ImportRecordDto,
  type Paged,
} from '@spendly/shared';
import { env } from '../config/env';
import { sha256Buffer } from '../lib/crypto';
import { csvRow } from '../lib/csv';
import { badRequest, conflict, notFound } from '../lib/errors';
import { authOf } from '../middleware/context';
import { uploadLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { Transaction } from '../models/finance';
import { ImportError, ImportJob, ImportRecord, type ImportJobDoc, type ImportRecordDoc } from '../models/imports';
import { detectHeaderRow, readTable, sniffFile, suggestMapping } from '../imports/readers';
import { enqueue } from '../imports/worker';
import { deleteFile, readFileBuffer, saveFile } from '../services/files';
import { loadRules } from '../services/classify';
import { loadLookups } from '../services/lookups';
import { objectIdParam, pageQuery } from '../services/query';

export const importsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxUploadBytes, files: 1 } });

async function toDto(job: ImportJobDoc): Promise<ImportJobDto> {
  const rows = await ImportRecord.aggregate<{ _id: { decision: string }; n: number }>([
    { $match: { jobId: job._id } },
    { $group: { _id: { decision: '$decision' }, n: { $sum: 1 } } },
  ]);
  const dec = Object.fromEntries(rows.map((r) => [r._id.decision, r.n])) as Record<string, number>;
  const total = job.progress.total || 1;
  const failedStatus = job.status === 'failed';
  return {
    id: job._id.toString(),
    filename: job.filename,
    fileType: job.fileType,
    sizeBytes: job.sizeBytes,
    kind: job.kind,
    source: 'csv',
    status: job.status as ImportJobDto['status'],
    progress: {
      phase: job.progress.phase,
      processed: job.progress.processed,
      total: job.progress.total,
      percent: job.status === 'ready_for_review' || job.status.startsWith('completed') ? 100 : Math.min(99, Math.round((job.progress.processed / total) * 100)),
    },
    sheets: job.sheets,
    headerRow: job.headerRow,
    columns: job.columns,
    sampleRows: job.sampleRows,
    detectedFormat: job.detectedFormat,
    suggestedMapping: job.suggestedMapping as ImportMapping | null,
    mapping: job.mapping as ImportMapping | null,
    stats: {
      totalRows: job.stats.totalRows,
      valid: job.stats.valid,
      invalid: job.stats.invalid,
      duplicates: job.stats.duplicates,
      uncertain: job.stats.uncertain,
      accepted: dec.accepted ?? 0,
      rejected: dec.rejected ?? 0,
      pending: dec.pending ?? 0,
      imported: job.stats.imported,
      failedToImport: job.stats.failedToImport,
    },
    error: job.error,
    notes: job.notes,
    canRetry: failedStatus || job.stats.failedToImport > 0,
    canRollback: (job.status === 'completed' || job.status === 'completed_with_errors') && job.stats.imported > 0,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const toRecordDto = (r: ImportRecordDoc): ImportRecordDto => {
  const d = r.draft as Record<string, unknown> | null;
  return {
    id: r._id.toString(),
    rowNumber: r.rowNumber,
    status: r.status,
    decision: r.decision,
    raw: r.raw,
    draft: d
      ? {
          merchantName: d.merchantName as string,
          amountPaise: d.amountPaise as number,
          date: new Date(d.date as Date).toISOString(),
          hasTime: Boolean(d.hasTime),
          type: d.type as ImportRecordDto['draft'] extends infer T ? (T extends { type: infer U } ? U : never) : never,
          platform: (d.platform as string | null) ?? null,
          category: (d.category as string | null) ?? null,
          subcategory: (d.subcategory as string | null) ?? null,
          paymentMethod: d.paymentMethod as never,
          description: (d.description as string) ?? '',
          externalRef: (d.externalRef as string | null) ?? null,
        }
      : null,
    classification: r.classification ? { source: r.classification.source as never, confidence: r.classification.confidence, reason: r.classification.reason, needsReview: r.classification.needsReview } : null,
    issues: r.issues,
    duplicateOf: r.duplicateOf ? { id: r.duplicateOf.id.toString(), merchantName: r.duplicateOf.merchantName, date: r.duplicateOf.date.toISOString(), amountPaise: r.duplicateOf.amountPaise } : null,
    importedTransactionId: r.importedTransactionId?.toString() ?? null,
  };
};

async function ownJob(userId: Types.ObjectId, id: string): Promise<HydratedDocument<ImportJobDoc>> {
  const job = await ImportJob.findOne({ _id: id, userId });
  if (!job) throw notFound('Import');
  return job;
}

// ── upload ─────────────────────────────────────────────────────────────────────────────────────

importsRouter.post('/', uploadLimiter, upload.single('file'), async (req, res) => {
  const auth = authOf(req);
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  const kindParsed = z.enum([...IMPORT_KINDS, 'receipt', 'email_receipt']).optional().safeParse(req.body?.kind || undefined);
  if (!kindParsed.success) throw badRequest('Unknown import kind');

  const sniffed = await sniffFile(req.file.buffer, req.file.originalname || 'upload');
  const table = await readTable(req.file.buffer, sniffed.fileType, { receipt: kindParsed.data === 'receipt' });
  const fileHash = sha256Buffer(req.file.buffer);
  const storageKey = await saveFile(auth.userId, req.file.buffer, sniffed.ext);

  const kind: ImportJobDoc['kind'] =
    sniffed.fileType === 'eml' ? 'email_receipt' : sniffed.fileType === 'image' || kindParsed.data === 'receipt' ? 'receipt' : ((kindParsed.data as ImportJobDoc['kind'] | undefined) ?? (sniffed.fileType === 'pdf' ? 'bank_statement' : 'generic'));
  const automatic = sniffed.fileType === 'pdf' || sniffed.fileType === 'eml' || sniffed.fileType === 'image';

  const headerRow = automatic ? 0 : detectHeaderRow(table.rows);
  const header = (table.rows[headerRow] ?? []).map((h) => String(h).trim());
  const sample = table.rows.slice(headerRow + 1, headerRow + 9);
  const suggestion = suggestMapping(header, table.rows.slice(headerRow + 1, headerRow + 40), detectDateOrder);

  const prior = await ImportJob.findOne({ userId: auth.userId, fileHash, status: { $in: ['completed', 'completed_with_errors', 'ready_for_review'] } }).sort({ createdAt: -1 }).lean();
  const notes = [...table.notes];
  if (prior) notes.push(`You uploaded this exact file on ${prior.createdAt.toISOString().slice(0, 10)}. Rows already imported will be flagged as duplicates.`);
  if (table.rows.length - headerRow - 1 >= 200_000) notes.push('Only the first 200,000 rows are read.');

  const mapping: ImportMapping | null = automatic
    ? {
        kind: kind === 'receipt' || kind === 'email_receipt' ? 'generic' : (kind as ImportMapping['kind']),
        headerRow: 0,
        columns: { date: 'Date', description: 'Description', merchant: sniffed.fileType === 'pdf' && kind !== 'receipt' ? null : 'Merchant', amount: 'Amount', time: null, debit: null, credit: null, drcr: null, reference: null, category: null, paymentMethod: null },
        dateOrder: 'dmy',
        amountSign: sniffed.fileType === 'pdf' && kind !== 'receipt' ? 'negative_is_expense' : 'all_expenses',
        defaultPaymentMethod: kind === 'receipt' ? 'cash' : 'bank_transfer',
      }
    : null;

  const job = await ImportJob.create({
    userId: auth.userId,
    filename: (req.file.originalname || 'upload').replace(/[^\w.\- ()]+/g, '_').slice(0, 160),
    fileType: sniffed.fileType,
    sizeBytes: req.file.size,
    fileHash,
    storageKey,
    kind,
    status: automatic ? 'queued' : 'needs_mapping',
    sheets: table.sheets,
    sheet: table.sheet,
    headerRow,
    columns: header,
    sampleRows: sample.map((r) => header.map((_, i) => String(r[i] ?? '').slice(0, 120))),
    detectedFormat: suggestion.detectedFormat,
    suggestedMapping: automatic ? mapping : { kind: suggestion.kind, headerRow, sheet: table.sheet ?? undefined, columns: suggestion.columns, dateOrder: suggestion.dateOrder, amountSign: suggestion.amountSign, defaultPaymentMethod: suggestion.kind === 'credit_card_statement' ? 'credit_card' : suggestion.kind === 'upi_export' ? 'upi' : 'bank_transfer' },
    mapping,
    notes: [...notes, ...suggestion.notes],
    progress: { phase: 'uploaded', processed: 0, total: Math.max(0, table.rows.length - headerRow - 1) },
    isDemo: auth.user.isDemo,
  });
  if (automatic) await enqueue(job._id, 'process');
  res.status(201).json({ data: await toDto((await ImportJob.findById(job._id)) as ImportJobDoc) });
});

importsRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  const jobs = await ImportJob.find({ userId: auth.userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ data: await Promise.all(jobs.map(toDto)) });
});

importsRouter.get('/:id', validate({ params: objectIdParam }), async (req, res) => {
  res.json({ data: await toDto(await ownJob(authOf(req).userId, req.valid.params.id)) });
});

/** Re-reads the file for another sheet or header row so the mapping step can show the right columns. */
importsRouter.get(
  '/:id/preview',
  validate({ params: objectIdParam, query: z.object({ sheet: z.string().max(80).optional(), headerRow: z.coerce.number().int().min(0).max(200).optional() }) }),
  async (req, res) => {
    const auth = authOf(req);
    const job = await ownJob(auth.userId, req.valid.params.id);
    if (job.fileType !== 'csv' && job.fileType !== 'xlsx') throw badRequest('Only spreadsheets and CSV files have a mapping step');
    const q = req.valid.query as { sheet?: string; headerRow?: number };
    const table = await readTable(await readFileBuffer(job.storageKey), job.fileType, { sheet: q.sheet ?? job.sheet });
    const headerRow = q.headerRow ?? detectHeaderRow(table.rows);
    const header = (table.rows[headerRow] ?? []).map((h) => String(h).trim());
    const suggestion = suggestMapping(header, table.rows.slice(headerRow + 1, headerRow + 40), detectDateOrder);
    res.json({
      data: {
        sheet: table.sheet,
        headerRow,
        columns: header,
        sampleRows: table.rows.slice(headerRow + 1, headerRow + 9).map((r) => header.map((_, i) => String(r[i] ?? '').slice(0, 120))),
        suggestedMapping: { kind: suggestion.kind, headerRow, sheet: table.sheet ?? undefined, columns: suggestion.columns, dateOrder: suggestion.dateOrder, amountSign: suggestion.amountSign, defaultPaymentMethod: 'bank_transfer' },
        notes: suggestion.notes,
      },
    });
  },
);

importsRouter.put('/:id/mapping', validate({ params: objectIdParam, body: importMappingSchema }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (!['needs_mapping', 'ready_for_review', 'failed', 'uploaded'].includes(job.status)) throw conflict('This import can no longer be remapped', undefined, 'IMPORT_BUSY');
  const mapping = req.valid.body as ImportMapping;
  const c = mapping.columns;
  if (!c.amount && !c.debit && !c.credit) throw badRequest('Choose an amount column, or debit and credit columns', undefined, 'INVALID_MAPPING');

  const table = await readTable(await readFileBuffer(job.storageKey), job.fileType, { sheet: mapping.sheet ?? job.sheet, receipt: job.kind === 'receipt' });
  const header = (table.rows[mapping.headerRow] ?? []).map((h) => String(h).trim());
  const unknown = Object.entries(c).filter(([, v]) => v && !header.includes(v)).map(([k, v]) => `${k}: "${v}"`);
  if (unknown.length) throw badRequest(`These columns are not in the header row: ${unknown.join(', ')}`, { unknown }, 'INVALID_MAPPING');

  // remapping discards earlier staging so counts always describe the current mapping
  await Promise.all([ImportRecord.deleteMany({ jobId: job._id }), ImportError.deleteMany({ jobId: job._id })]);
  job.mapping = mapping as unknown as Record<string, unknown>;
  job.sheet = table.sheet;
  job.headerRow = mapping.headerRow;
  job.columns = header;
  job.kind = mapping.kind;
  job.cursor = 0;
  job.stats = { totalRows: 0, valid: 0, invalid: 0, duplicates: 0, uncertain: 0, imported: 0, failedToImport: 0 };
  job.progress = { phase: 'queued', processed: 0, total: Math.max(0, table.rows.length - mapping.headerRow - 1) };
  await job.save();
  await enqueue(job._id, 'process');
  res.json({ data: await toDto((await ImportJob.findById(job._id)) as ImportJobDoc) });
});

// ── review ─────────────────────────────────────────────────────────────────────────────────────

const recordsQuery = pageQuery.extend({
  status: z.enum(['valid', 'invalid', 'duplicate', 'uncertain']).optional(),
  decision: z.enum(['accepted', 'rejected', 'pending']).optional(),
  q: z.string().trim().max(80).optional(),
});

importsRouter.get('/:id/records', validate({ params: objectIdParam, query: recordsQuery }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  const q = req.valid.query as z.output<typeof recordsQuery>;
  const match: QueryFilter<ImportRecordDoc> = { jobId: job._id, userId: auth.userId };
  if (q.status) match.status = q.status;
  if (q.decision) match.decision = q.decision;
  if (q.q) {
    const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [{ 'draft.merchantName': re }, { 'draft.description': re }, { rowNumber: Number(q.q) || -1 }];
  }
  const [docs, total] = await Promise.all([
    ImportRecord.find(match).sort({ rowNumber: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ImportRecord.countDocuments(match),
  ]);
  const body: Paged<ImportRecordDto> = { items: docs.map(toRecordDto), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) } };
  res.json({ data: body });
});

importsRouter.patch('/:id/records/:rid', validate({ params: objectIdParam.extend({ rid: z.string().regex(/^[a-f\d]{24}$/i) }), body: importRecordPatchSchema }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (!['ready_for_review', 'completed_with_errors', 'completed'].includes(job.status)) throw conflict('Records can be edited once processing has finished', undefined, 'IMPORT_BUSY');
  const rec = await ImportRecord.findOne({ _id: req.valid.params.rid, jobId: job._id, userId: auth.userId });
  if (!rec) throw notFound('Record');
  if (rec.importedTransactionId) throw conflict('This row has already been imported. Edit the transaction instead.', undefined, 'ALREADY_IMPORTED');
  const b = req.valid.body as z.output<typeof importRecordPatchSchema>;

  const edited = b.merchantName !== undefined || b.amountPaise !== undefined || b.date !== undefined || b.type !== undefined || b.platform !== undefined || b.category !== undefined || b.paymentMethod !== undefined;
  if (edited) {
    const lk = await loadLookups(auth.userId);
    if (b.platform && !lk.platforms.has(b.platform)) throw badRequest('Unknown platform', undefined, 'INVALID_PLATFORM');
    if (b.category && !lk.categories.has(b.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
    const d = { ...((rec.draft as Record<string, unknown> | null) ?? {}) } as Record<string, unknown>;
    if (b.merchantName !== undefined) d.merchantName = b.merchantName;
    if (b.amountPaise !== undefined) d.amountPaise = b.amountPaise;
    if (b.date !== undefined) d.date = new Date(b.date);
    if (b.type !== undefined) d.type = b.type;
    if (b.paymentMethod !== undefined) d.paymentMethod = b.paymentMethod;
    d.type ??= 'expense';
    d.paymentMethod ??= 'other';
    d.hasTime ??= false;
    d.description ??= '';
    d.externalRef ??= null;
    d.refundOfId ??= null;
    if (!d.merchantName || !d.amountPaise || !d.date) {
      throw badRequest('A merchant, an amount and a date are needed before this row can be imported', undefined, 'INCOMPLETE_RECORD');
    }
    if (b.platform !== undefined || b.category !== undefined) {
      if (b.platform !== undefined) d.platform = b.platform;
      if (b.category !== undefined) d.category = b.category;
      rec.classification = { source: 'user', confidence: 1, reason: 'Set by you', needsReview: false, ruleId: null };
    } else if (!rec.classification || b.merchantName !== undefined) {
      const rules = await loadRules(auth.userId);
      const r = recognize({ merchant: d.merchantName as string, description: d.description as string, direction: d.type === 'income' || d.type === 'refund' ? 'credit' : 'debit' }, { rules, customPlatforms: lk.customPlatforms });
      d.platform ??= r.platform;
      d.category ??= r.category;
      d.subcategory ??= r.subcategory;
      d.merchantKey = r.merchantKey;
      rec.classification = { source: r.source, confidence: r.confidence, reason: r.reason, needsReview: r.needsReview, ruleId: r.ruleId };
    }
    d.merchantKey ??= `m:${String(d.merchantName).toUpperCase()}`;
    rec.draft = d;
    rec.issues = [];
    rec.status = rec.classification?.needsReview ? 'uncertain' : 'valid';
    rec.decision = b.decision ?? 'accepted';
    rec.duplicateOf = null;
    await ImportError.deleteMany({ jobId: job._id, rowNumber: rec.rowNumber });
  } else if (b.decision) {
    if (rec.status === 'invalid') throw badRequest('This row is invalid — fix it first, then accept it', undefined, 'INVALID_RECORD');
    rec.decision = b.decision;
  }
  await rec.save();
  const [valid, invalid, duplicate, uncertain] = await Promise.all((['valid', 'invalid', 'duplicate', 'uncertain'] as const).map((s) => ImportRecord.countDocuments({ jobId: job._id, status: s })));
  await ImportJob.updateOne({ _id: job._id }, { $set: { 'stats.valid': valid, 'stats.invalid': invalid, 'stats.duplicates': duplicate, 'stats.uncertain': uncertain } });
  res.json({ data: toRecordDto(rec.toObject()) });
});

importsRouter.post('/:id/records/bulk', validate({ params: objectIdParam, body: importBulkDecisionSchema }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  const b = req.valid.body as z.output<typeof importBulkDecisionSchema>;
  const match: QueryFilter<ImportRecordDoc> = { jobId: job._id, userId: auth.userId, importedTransactionId: null, status: b.filter.status ?? { $ne: 'invalid' } };
  if (b.filter.status === 'invalid' && b.decision === 'accepted') throw badRequest('Invalid rows cannot be accepted until they are fixed', undefined, 'INVALID_RECORD');
  if (b.filter.merchantKey) match.merchantKey = b.filter.merchantKey;
  const result = await ImportRecord.updateMany(match, { $set: { decision: b.decision } });
  res.json({ data: { modified: result.modifiedCount } });
});

// ── confirm / retry / rollback / delete ────────────────────────────────────────────────────────

importsRouter.post('/:id/confirm', validate({ params: objectIdParam, body: importConfirmSchema }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (!['ready_for_review', 'completed_with_errors', 'completed', 'failed'].includes(job.status)) throw conflict('This import is not ready to be confirmed yet', undefined, 'IMPORT_BUSY');
  const b = req.valid.body as z.output<typeof importConfirmSchema>;
  const pending = await ImportRecord.countDocuments({ jobId: job._id, decision: 'pending' });
  if (pending > 0 && !b.pending) {
    throw conflict(`${pending} possible duplicate${pending === 1 ? ' is' : 's are'} waiting for your decision`, { pending }, 'PENDING_DECISIONS');
  }
  if (pending > 0 && b.pending) await ImportRecord.updateMany({ jobId: job._id, decision: 'pending' }, { $set: { decision: b.pending === 'import' ? 'accepted' : 'rejected' } });
  const toImport = await ImportRecord.countDocuments({ jobId: job._id, decision: 'accepted', status: { $ne: 'invalid' as const }, importedTransactionId: null });
  if (toImport === 0) throw badRequest('There is nothing to import — every row is rejected, invalid or already imported', undefined, 'NOTHING_TO_IMPORT');
  job.learn = b.learnConfirmed;
  await job.save();
  await enqueue(job._id, 'import');
  res.status(202).json({ data: await toDto((await ImportJob.findById(job._id)) as ImportJobDoc) });
});

importsRouter.post('/:id/retry', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (job.queue.state !== 'idle') throw conflict('This import is already running', undefined, 'IMPORT_BUSY');
  const needsImport = job.stats.failedToImport > 0 || job.queue.task === 'import';
  if (job.status !== 'failed' && !needsImport) throw badRequest('Nothing to retry for this import', undefined, 'NOTHING_TO_RETRY');
  await enqueue(job._id, needsImport ? 'import' : (job.queue.task === 'rollback' ? 'rollback' : 'process'));
  res.status(202).json({ data: await toDto((await ImportJob.findById(job._id)) as ImportJobDoc) });
});

importsRouter.post('/:id/rollback', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (!['completed', 'completed_with_errors'].includes(job.status)) throw conflict('Only a finished import can be undone', undefined, 'IMPORT_BUSY');
  await enqueue(job._id, 'rollback');
  res.status(202).json({ data: await toDto((await ImportJob.findById(job._id)) as ImportJobDoc) });
});

importsRouter.delete('/:id', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  if (job.queue.state !== 'idle') throw conflict('Wait for the running step to finish first', undefined, 'IMPORT_BUSY');
  const kept = await Transaction.countDocuments({ userId: auth.userId, importJobId: job._id });
  await Promise.all([ImportRecord.deleteMany({ jobId: job._id }), ImportError.deleteMany({ jobId: job._id }), ImportJob.deleteOne({ _id: job._id })]);
  // a receipt image stays alive while a transaction still points at it
  const stillReferenced = await Transaction.exists({ userId: auth.userId, 'receipt.fileId': job.storageKey });
  if (!stillReferenced) await deleteFile(job.storageKey);
  res.json({ data: { ok: true, transactionsKept: kept } });
});

/** Every rejected row with the reason, so nothing is lost and the source file can be corrected. */
importsRouter.get('/:id/errors.csv', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const job = await ownJob(auth.userId, req.valid.params.id);
  const cols = job.columns.filter(Boolean).slice(0, 30);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-errors-${job._id.toString().slice(-6)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.write('﻿');
  res.write(csvRow(['row', 'field', 'code', 'problem', ...cols]));
  for await (const e of ImportError.find({ jobId: job._id }).sort({ rowNumber: 1 }).lean().cursor()) {
    const ok = res.write(csvRow([e.rowNumber, e.field ?? '', e.code, e.message, ...cols.map((c) => e.raw?.[c] ?? '')]));
    if (!ok) await once(res, 'drain');
  }
  // rows that imported fine but failed to save
  for await (const r of ImportRecord.find({ jobId: job._id, importError: { $ne: null } }).sort({ rowNumber: 1 }).lean().cursor()) {
    res.write(csvRow([r.rowNumber, '', 'IMPORT_FAILED', r.importError, ...cols.map((c) => r.raw?.[c] ?? '')]));
  }
  res.end();
});

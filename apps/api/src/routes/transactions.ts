import { once } from 'node:events';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import {
  bulkActionSchema,
  duplicateResolveSchema,
  localDateKey,
  parseAmount,
  parseDateValue,
  scoreDuplicate,
  transactionInputSchema,
  transactionUpdateSchema,
  type DuplicateGroupDto,
  type Paged,
  type TransactionDto,
} from '@spendly/shared';
import { csvRow, paiseToDecimal } from '../lib/csv';
import { badRequest, notFound, unprocessable } from '../lib/errors';
import { authOf } from '../middleware/context';
import { exportLimiter, uploadLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { Transaction, type TransactionDoc } from '../models/finance';
import { totalsForMatch, transactionInsights } from '../services/analytics';
import { checkBudgetAlerts } from '../services/budgets';
import { deleteFile, openFile, saveFile } from '../services/files';
import { loadLookups } from '../services/lookups';
import { buildMatch, filterQuery, objectIdParam, pageQuery, rangeQuery, rangesFor } from '../services/query';
import { toTransactionDto } from '../services/serialize';
import { renderReportPdf } from '../services/report-pdf';
import { buildStatement } from '../services/reports';
import { buildSearchText, createTransaction, deleteTransaction, updateTransaction } from '../services/transactions';
import { logger } from '../lib/logger';

export const transactionsRouter = Router();

const listQuery = rangeQuery.extend(filterQuery.shape).extend(pageQuery.shape).extend({
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['date', 'amount', 'merchant']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  tag: z.string().trim().max(30).optional(),
  needsReview: z.enum(['true', 'false']).optional(),
  duplicates: z.enum(['true', 'false']).optional(),
  recurring: z.enum(['true', 'false']).optional(),
  /** Only orders that arrived through a linked account (Swiggy, Zepto, Zomato). */
  linked: z.enum(['true', 'false']).optional(),
  /** Only transactions created by one import (used by "view imported transactions"). */
  importJob: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});
type ListQuery = z.output<typeof listQuery>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Free-text search: an amount, a date, or words from the merchant, platform, category, notes and tags. */
function searchClause(q: string, tz: string): QueryFilter<TransactionDoc> {
  const asAmount = /^[₹\s]*\d[\d,]*(\.\d{1,2})?$/.test(q);
  const asDate = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(q);
  if (asDate) {
    const parsed = parseDateValue(q, { tz });
    if (parsed.ok) {
      const key = localDateKey(parsed.date, tz);
      const start = new Date(`${key}T00:00:00Z`);
      // widen by a day on each side then rely on the local-day check below being cheap via the date index
      return { date: { $gte: new Date(start.getTime() - 14 * 3_600_000), $lt: new Date(start.getTime() + 38 * 3_600_000) }, searchText: { $exists: true } };
    }
  }
  const clauses: QueryFilter<TransactionDoc>[] = [{ searchText: { $regex: escapeRe(q.toLowerCase()) } }];
  if (asAmount) {
    try {
      clauses.push({ amountPaise: parseAmount(q).paise });
    } catch {
      /* not an amount after all */
    }
  }
  return { $or: clauses };
}

/** Everything the list and its insights share: range, filters, quick views and search. */
function listMatch(auth: ReturnType<typeof authOf>, q: ListQuery): QueryFilter<TransactionDoc> {
  const range = q.preset || q.from || q.to ? rangesFor(auth, q).range : undefined;
  const match = buildMatch(auth, { range, filters: q }) as QueryFilter<TransactionDoc>;
  if (q.tag) match.tags = q.tag;
  if (q.needsReview === 'true') match['classification.needsReview'] = true;
  if (q.duplicates === 'true') match.duplicateStatus = 'possible';
  if (q.recurring === 'true') match.recurringPaymentId = { $ne: null };
  if (q.linked === 'true') match.importSource = 'integration';
  if (q.importJob) match.importJobId = new Types.ObjectId(q.importJob);
  if (q.q) Object.assign(match, searchClause(q.q, auth.tz));
  return match;
}

transactionsRouter.get('/insights', validate({ query: listQuery }), async (req, res) => {
  const auth = authOf(req);
  res.json({ data: await transactionInsights(listMatch(auth, req.valid.query as ListQuery), auth.tz) });
});

transactionsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as ListQuery;
  const match = listMatch(auth, q);

  const dir = q.order === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> =
    q.sort === 'amount' ? { amountPaise: dir, _id: dir } : q.sort === 'merchant' ? { merchantName: dir, _id: dir } : { date: dir, _id: dir };
  let query = Transaction.find(match).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize);
  if (q.sort === 'merchant') query = query.collation({ locale: 'en', strength: 2 });

  const [docs, total, totals, lk] = await Promise.all([query.lean(), Transaction.countDocuments(match), totalsForMatch(match), loadLookups(auth.userId)]);
  const body: Paged<TransactionDto> & { totals: typeof totals } = {
    items: docs.map((d) => toTransactionDto(d, lk)),
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    totals,
  };
  res.json({ data: body });
});

transactionsRouter.post('/', validate({ body: transactionInputSchema }), async (req, res) => {
  const auth = authOf(req);
  const { doc, warnings } = await createTransaction(auth, req.valid.body);
  void checkBudgetAlerts(auth).catch((e) => logger.warn({ err: e }, 'budget alert check failed'));
  const lk = await loadLookups(auth.userId);
  res.status(201).json({ data: { transaction: toTransactionDto(doc, lk), warnings } });
});

const exportQuery = rangeQuery.extend(filterQuery.shape).extend({ format: z.enum(['csv', 'pdf']).default('csv') });

/** Streams every transaction matching the filters as CSV (spreadsheet-safe), or as a printable PDF statement. */
transactionsRouter.get('/export', exportLimiter, validate({ query: exportQuery }), async (req, res) => {
  const auth = authOf(req);
  const q = req.valid.query as z.output<typeof exportQuery>;
  const range = q.preset || q.from || q.to ? rangesFor(auth, q).range : undefined;
  const match = buildMatch(auth, { range, filters: q });
  const lk = await loadLookups(auth.userId);
  const now = new Date();
  const stamp = localDateKey(now, auth.tz);

  if (q.format === 'pdf') {
    const statement = await buildStatement(auth, lk, match, range, now);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="spendly-transactions-${stamp}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    const doc = renderReportPdf(statement);
    doc.pipe(res);
    doc.end();
    return;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spendly-transactions-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.write('﻿');
  res.write(csvRow(['date', 'time', 'merchant', 'platform', 'category', 'subcategory', 'type', 'status', 'payment_method', 'amount_inr', 'description', 'notes', 'tags', 'external_ref', 'source']));
  const cursor = Transaction.find(match).sort({ date: 1, _id: 1 }).lean().cursor();
  for await (const t of cursor) {
    const iso = t.date.toISOString();
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: auth.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(t.date);
    const ok = res.write(
      csvRow([
        localDateKey(t.date, auth.tz),
        t.hasTime ? local : '',
        t.merchantName,
        lk.platformName(t.platform) ?? '',
        lk.categoryName(t.category) ?? '',
        t.subcategory ?? '',
        t.type,
        t.status,
        t.paymentMethod,
        paiseToDecimal(t.amountPaise),
        t.description,
        t.notes,
        t.tags.join('; '),
        t.externalRef ?? '',
        t.importSource,
      ]),
    );
    void iso;
    if (!ok) await once(res, 'drain');
  }
  res.end();
});

transactionsRouter.post('/bulk', validate({ body: bulkActionSchema }), async (req, res) => {
  const auth = authOf(req);
  const body = req.valid.body as z.output<typeof bulkActionSchema>;
  const scope = { userId: auth.userId, _id: { $in: body.ids } };
  const lk = await loadLookups(auth.userId);

  if (body.action === 'delete') {
    const docs = await Transaction.find(scope).select('receipt').lean();
    const result = await Transaction.deleteMany(scope);
    await Promise.all([
      ...docs.map((d) => deleteFile(d.receipt?.fileId)),
      Transaction.updateMany({ userId: auth.userId, refundOfId: { $in: body.ids } }, { $set: { refundOfId: null } }),
    ]);
    res.json({ data: { matched: docs.length, modified: result.deletedCount } });
    return;
  }
  if (body.action === 'add_tag') {
    const result = await Transaction.updateMany(scope, { $addToSet: { tags: body.tag } });
    res.json({ data: { matched: result.matchedCount, modified: result.modifiedCount } });
    return;
  }
  if (body.action === 'set_type') {
    const result = await Transaction.updateMany(scope, { $set: { type: body.type } });
    res.json({ data: { matched: result.matchedCount, modified: result.modifiedCount } });
    return;
  }
  if (body.action === 'confirm_classification') {
    const result = await Transaction.updateMany(scope, { $set: { 'classification.source': 'user', 'classification.confidence': 1, 'classification.reason': 'Confirmed by you', 'classification.needsReview': false } });
    res.json({ data: { matched: result.matchedCount, modified: result.modifiedCount } });
    return;
  }

  // categorize / set_platform rewrite searchText too, so search keeps finding the new names
  if (body.action === 'categorize' && !lk.categories.has(body.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
  if (body.action === 'set_platform' && body.platform && !lk.platforms.has(body.platform)) throw badRequest('Unknown platform', undefined, 'INVALID_PLATFORM');
  const docs = await Transaction.find(scope).lean();
  const user = { source: 'user' as const, confidence: 1, reason: 'Set by you', needsReview: false, ruleId: null };
  const ops = docs.map((d) => {
    const next = { ...d };
    if (body.action === 'categorize') {
      next.category = body.category;
      next.subcategory = body.subcategory ?? null;
    } else if (body.action === 'set_platform') {
      next.platform = body.platform;
      if (body.platform) next.merchantKey = `p:${body.platform}`;
    }
    return {
      updateOne: {
        filter: { _id: d._id, userId: auth.userId },
        update: { $set: { category: next.category, subcategory: next.subcategory, platform: next.platform, merchantKey: next.merchantKey, classification: user, searchText: buildSearchText(next, lk) } },
      },
    };
  });
  const result = ops.length ? await Transaction.bulkWrite(ops) : { matchedCount: 0, modifiedCount: 0 };
  res.json({ data: { matched: result.matchedCount, modified: result.modifiedCount } });
});

// ── possible duplicates ────────────────────────────────────────────────────────────────────────

transactionsRouter.get('/duplicates', async (req, res) => {
  const auth = authOf(req);
  const flagged = await Transaction.find({ userId: auth.userId, duplicateStatus: 'possible', duplicateOfId: { $ne: null } }).sort({ date: -1 }).limit(100).lean();
  const others = await Transaction.find({ userId: auth.userId, _id: { $in: flagged.map((f) => f.duplicateOfId) } }).lean();
  const byId = new Map(others.map((o) => [o._id.toString(), o]));
  const lk = await loadLookups(auth.userId);
  const groups: DuplicateGroupDto[] = [];
  for (const f of flagged) {
    const other = byId.get(f.duplicateOfId?.toString() ?? '');
    if (!other) continue;
    const s = scoreDuplicate(
      { date: f.date, amountPaise: f.amountPaise, type: f.type, merchantKey: f.merchantKey, externalRef: f.externalRef, hasTime: f.hasTime },
      { date: other.date, amountPaise: other.amountPaise, type: other.type, merchantKey: other.merchantKey, externalRef: other.externalRef, hasTime: other.hasTime },
      auth.tz,
    );
    groups.push({ id: f._id.toString(), reasons: s.reasons, score: s.score, transactions: [toTransactionDto(other, lk), toTransactionDto(f, lk)] });
  }
  res.json({ data: groups });
});

transactionsRouter.post('/duplicates/resolve', validate({ body: duplicateResolveSchema }), async (req, res) => {
  const auth = authOf(req);
  const { keepId, removeIds, dismiss } = req.valid.body as z.output<typeof duplicateResolveSchema>;
  const ids = [keepId, ...removeIds];
  const owned = await Transaction.find({ userId: auth.userId, _id: { $in: ids } }).select('_id receipt').lean();
  if (owned.length !== new Set(ids).size) throw notFound('Transaction');
  if (dismiss) {
    await Transaction.updateMany({ userId: auth.userId, _id: { $in: ids } }, { $set: { duplicateStatus: 'dismissed', duplicateOfId: null } });
  } else {
    const removing = owned.filter((o) => removeIds.includes(o._id.toString()));
    await Transaction.deleteMany({ userId: auth.userId, _id: { $in: removeIds } });
    await Promise.all(removing.map((r) => deleteFile(r.receipt?.fileId)));
    await Transaction.updateMany({ userId: auth.userId, $or: [{ _id: keepId }, { duplicateOfId: { $in: removeIds } }] }, { $set: { duplicateStatus: 'none', duplicateOfId: null } });
  }
  void checkBudgetAlerts(auth).catch(() => undefined);
  res.json({ data: { ok: true, removed: dismiss ? 0 : removeIds.length } });
});

// ── single transaction ─────────────────────────────────────────────────────────────────────────

transactionsRouter.get('/:id', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const doc = await Transaction.findOne({ _id: req.valid.params.id, userId: auth.userId }).lean();
  if (!doc) throw notFound('Transaction');
  const lk = await loadLookups(auth.userId);
  res.json({ data: toTransactionDto(doc, lk) });
});

transactionsRouter.patch('/:id', validate({ params: objectIdParam, body: transactionUpdateSchema }), async (req, res) => {
  const auth = authOf(req);
  const outcome = await updateTransaction(auth, req.valid.params.id, req.valid.body);
  void checkBudgetAlerts(auth).catch(() => undefined);
  const lk = await loadLookups(auth.userId);
  res.json({
    data: {
      transaction: toTransactionDto(outcome.doc, lk),
      similarCount: outcome.similarCount,
      suggestRule: outcome.suggestRule,
      ruleId: outcome.ruleId,
    },
  });
});

transactionsRouter.delete('/:id', validate({ params: objectIdParam }), async (req, res) => {
  await deleteTransaction(authOf(req), req.valid.params.id);
  res.json({ data: { ok: true } });
});

// ── receipts ───────────────────────────────────────────────────────────────────────────────────

const RECEIPT_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

transactionsRouter.post('/:id/receipt', uploadLimiter, validate({ params: objectIdParam }), receiptUpload.single('file'), async (req, res) => {
  const auth = authOf(req);
  const txn = await Transaction.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!txn) throw notFound('Transaction');
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  // trust the bytes, not the filename or the declared content type
  const sniffed = await fileTypeFromBuffer(req.file.buffer);
  const ext = sniffed ? RECEIPT_TYPES.get(sniffed.mime) : undefined;
  if (!sniffed || !ext) throw unprocessable('Receipts must be a PNG, JPEG, WebP or PDF file', undefined, 'UNSUPPORTED_FILE');
  const previous = txn.receipt?.fileId;
  const key = await saveFile(auth.userId, req.file.buffer, ext);
  txn.receipt = { fileId: key, filename: (req.file.originalname || `receipt.${ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120), mimeType: sniffed.mime, size: req.file.size };
  await txn.save();
  await deleteFile(previous);
  const lk = await loadLookups(auth.userId);
  res.status(201).json({ data: toTransactionDto(txn.toObject(), lk) });
});

transactionsRouter.get('/:id/receipt', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const txn = await Transaction.findOne({ _id: req.valid.params.id, userId: auth.userId }).select('receipt').lean();
  if (!txn?.receipt) throw notFound('Receipt');
  res.setHeader('Content-Type', txn.receipt.mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(txn.receipt.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = openFile(txn.receipt.fileId);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

transactionsRouter.delete('/:id/receipt', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const txn = await Transaction.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!txn) throw notFound('Transaction');
  const key = txn.receipt?.fileId;
  txn.receipt = null;
  await txn.save();
  await deleteFile(key);
  res.json({ data: { ok: true } });
});

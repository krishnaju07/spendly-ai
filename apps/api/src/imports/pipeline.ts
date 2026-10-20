import { Types } from 'mongoose';
import {
  PAYMENT_METHODS,
  baseFingerprint,
  localDateKey,
  parseAmount,
  parseDateValue,
  parseNarration,
  scoreDuplicate,
  suggestRuleFromMerchant,
  type ImportMapping,
  type PaymentMethod,
  type TransactionType,
} from '@spendly/shared';
import { readReceiptWithLlm } from '../ai/service';
import { logger } from '../lib/logger';
import type { AuthContext } from '../middleware/context';
import { User, UserPreference } from '../models/account';
import { MerchantRule, Transaction } from '../models/finance';
import { ImportError, ImportJob, ImportRecord, type ImportErrorDoc, type ImportJobDoc, type ImportRecordDoc } from '../models/imports';
import { createClassifier } from '../services/classify';
import { readFileBuffer } from '../services/files';
import { loadLookups } from '../services/lookups';
import { notify } from '../services/notifications';
import { runRecurringDetection } from '../services/recurring';
import { checkBudgetAlerts } from '../services/budgets';
import { findRefundOriginal, toTransactionDoc, type TransactionDraft } from '../services/transactions';
import { readTable } from './readers';

const BATCH = 500;
const RECORD_TTL_MS = 45 * 86_400_000;
const tick = () => new Promise<void>((r) => setImmediate(r));

type Issue = { code: string; message: string; field?: string };

export async function authFor(userId: Types.ObjectId): Promise<AuthContext> {
  const [user, prefs] = await Promise.all([User.findById(userId).lean(), UserPreference.findOne({ userId }).lean()]);
  if (!user || !prefs) throw new Error('Account no longer exists');
  return { userId, user, prefs, sessionId: new Types.ObjectId(), sessionTokenHash: '', tz: prefs.timezone, weekStartsOn: prefs.weekStartsOn === 7 ? 7 : 1 };
}

const truncate = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

function inferPaymentMethod(text: string): PaymentMethod | null {
  const t = text.toLowerCase();
  if (/\bupi\b|gpay|google pay|phonepe|bhim/.test(t)) return 'upi';
  if (/credit/.test(t)) return 'credit_card';
  if (/debit|atm|pos/.test(t)) return 'debit_card';
  if (/net ?bank|neft|rtgs|imps|bank transfer|ach/.test(t)) return t.includes('net') ? 'net_banking' : 'bank_transfer';
  if (/wallet|paytm balance/.test(t)) return 'wallet';
  if (/cash/.test(t)) return 'cash';
  return (PAYMENT_METHODS as readonly string[]).includes(t) ? (t as PaymentMethod) : null;
}

interface ParsedRow {
  index: number;
  rowNumber: number;
  raw: Record<string, string>;
  issues: Issue[];
  date?: Date;
  hasTime?: boolean;
  amountPaise?: number;
  direction?: 'debit' | 'credit';
  description: string;
  merchant: string;
  reference: string | null;
  paymentText: string | null;
  categoryText: string | null;
}

function parseRow(
  cells: string[],
  index: number,
  header: string[],
  mapping: ImportMapping,
  tz: string,
  now: Date,
  sourceRowOffset: number,
): ParsedRow {
  const col = (name: string | null | undefined) => {
    if (!name) return '';
    const i = header.indexOf(name);
    return i >= 0 ? (cells[i] ?? '').trim() : '';
  };
  const raw: Record<string, string> = {};
  header.slice(0, 30).forEach((h, i) => {
    if (h) raw[h] = truncate(cells[i] ?? '');
  });
  const c = mapping.columns;
  const row: ParsedRow = {
    index,
    rowNumber: sourceRowOffset + index + 1,
    raw,
    issues: [],
    description: col(c.description) || col(c.merchant),
    merchant: col(c.merchant),
    reference: col(c.reference) || null,
    paymentText: col(c.paymentMethod) || null,
    categoryText: col(c.category) || null,
  };

  // date
  const dateCell = col(c.date);
  if (!dateCell) {
    row.issues.push({ code: 'NO_DATE', field: c.date, message: 'No date — this looks like a header, footer or summary line' });
  } else {
    const timeCell = col(c.time);
    const parsed = parseDateValue(timeCell && !/\d:\d/.test(dateCell) ? `${dateCell} ${timeCell}` : dateCell, { tz, order: mapping.dateOrder });
    if (!parsed.ok) row.issues.push({ code: 'BAD_DATE', field: c.date, message: parsed.reason });
    else {
      const year = parsed.date.getUTCFullYear();
      if (year < 1995) row.issues.push({ code: 'BAD_DATE', field: c.date, message: 'Date is before 1995' });
      else if (parsed.date.getTime() > now.getTime() + 7 * 86_400_000) row.issues.push({ code: 'FUTURE_DATE', field: c.date, message: 'Date is more than a week in the future' });
      else {
        row.date = parsed.date;
        row.hasTime = parsed.hasTime;
      }
    }
  }

  // amount and direction
  const amountResult = readAmount(col, mapping);
  if ('issue' in amountResult) row.issues.push(amountResult.issue);
  else {
    row.amountPaise = amountResult.paise;
    row.direction = amountResult.direction;
  }
  if (!row.description && !row.merchant) row.description = '';
  return row;
}

function readAmount(
  col: (n: string | null | undefined) => string,
  mapping: ImportMapping,
): { paise: number; direction: 'debit' | 'credit' } | { issue: Issue } {
  const c = mapping.columns;
  const parse = (value: string, field: string | null | undefined) => {
    try {
      const a = parseAmount(value);
      if (a.foreignCurrency) return { issue: { code: 'FOREIGN_CURRENCY', field: field ?? undefined, message: `Amount is in ${a.foreignCurrency}; only INR is supported — convert it first` } as Issue };
      return a;
    } catch (error) {
      return { issue: { code: 'BAD_AMOUNT', field: field ?? undefined, message: (error as Error).message } as Issue };
    }
  };

  if (c.debit || c.credit) {
    const d = col(c.debit);
    const cr = col(c.credit);
    const pd = d ? parse(d, c.debit) : null;
    const pc = cr ? parse(cr, c.credit) : null;
    if (pd && 'issue' in pd) return pd;
    if (pc && 'issue' in pc) return pc;
    const debit = pd && !('issue' in pd) ? pd.paise : 0;
    const credit = pc && !('issue' in pc) ? pc.paise : 0;
    if (debit > 0 && credit > 0) return { issue: { code: 'AMBIGUOUS_DIRECTION', message: 'Both a debit and a credit amount are filled in' } };
    if (debit > 0) return { paise: debit, direction: 'debit' };
    if (credit > 0) return { paise: credit, direction: 'credit' };
    return { issue: { code: 'NO_AMOUNT', field: c.debit ?? c.credit ?? undefined, message: 'No amount in the debit or credit column' } };
  }

  const cell = col(c.amount);
  if (!cell) return { issue: { code: 'NO_AMOUNT', field: c.amount ?? undefined, message: 'No amount' } };
  const parsed = parse(cell, c.amount);
  if ('issue' in parsed) return parsed;
  if (parsed.paise === 0) return { issue: { code: 'ZERO_AMOUNT', field: c.amount ?? undefined, message: 'Amount is zero' } };

  if (c.drcr) {
    const marker = col(c.drcr).toUpperCase();
    if (/^(DR|D|DEBIT|WITHDRAWAL|PAID)/.test(marker)) return { paise: parsed.paise, direction: 'debit' };
    if (/^(CR|C|CREDIT|DEPOSIT|RECEIVED)/.test(marker)) return { paise: parsed.paise, direction: 'credit' };
    return { issue: { code: 'AMBIGUOUS_DIRECTION', field: c.drcr, message: `Could not tell debit from credit ("${col(c.drcr)}")` } };
  }
  if (parsed.drcr) return { paise: parsed.paise, direction: parsed.drcr === 'DR' ? 'debit' : 'credit' };
  if (mapping.amountSign === 'all_expenses') return { paise: parsed.paise, direction: 'debit' };
  const expenseWhenNegative = mapping.amountSign === 'negative_is_expense';
  return { paise: parsed.paise, direction: parsed.negative === expenseWhenNegative ? 'debit' : 'credit' };
}

/** Counts staged records by status/decision and stores the totals on the job. */
async function refreshStats(job: ImportJobDoc): Promise<void> {
  const rows = await ImportRecord.aggregate<{ _id: { status: string }; n: number }>([
    { $match: { jobId: job._id } },
    { $group: { _id: { status: '$status' }, n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id.status, r.n])) as Record<string, number>;
  const [imported] = await Promise.all([ImportRecord.countDocuments({ jobId: job._id, importedTransactionId: { $ne: null } })]);
  await ImportJob.updateOne(
    { _id: job._id },
    {
      $set: {
        'stats.totalRows': Object.values(by).reduce((a, b) => a + b, 0),
        'stats.valid': by.valid ?? 0,
        'stats.invalid': by.invalid ?? 0,
        'stats.duplicates': by.duplicate ?? 0,
        'stats.uncertain': by.uncertain ?? 0,
        'stats.imported': imported,
      },
    },
  );
}

/** Reads, normalises, classifies and de-duplicates every row into staged records the user can review. */
export async function processJob(jobId: Types.ObjectId): Promise<void> {
  const job = await ImportJob.findById(jobId);
  if (!job || job.status === 'cancelled') return;
  const auth = await authFor(job.userId);
  const mapping = job.mapping as ImportMapping | null;
  if (!mapping) throw new Error('This import has no column mapping yet');

  await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'processing', 'progress.phase': 'reading', error: null } });
  const buffer = await readFileBuffer(job.storageKey);
  const table = await readTable(buffer, job.fileType, { sheet: job.sheet, receipt: job.kind === 'receipt' });
  const header = table.rows[job.headerRow] ?? [];
  const dataRows = table.rows.slice(job.headerRow + 1);

  // image receipts have no table: ask the AI reader if the user enabled it, otherwise leave blanks to fill in
  if (job.fileType === 'image') {
    const reading = await readReceiptWithLlm(auth.prefs, { mediaType: 'image/jpeg', dataBase64: buffer.toString('base64') });
    if (reading) {
      dataRows[0] = [reading.date ?? '', reading.merchant ?? '', 'Receipt', reading.total ?? ''];
      job.notes.push('Read with your AI provider — check every field before importing.');
    } else job.notes.push('Receipt images are stored but not read automatically. Fill in the details below, or enable AI receipt reading in Settings.');
  }

  const total = dataRows.length;
  if (total === 0) throw new Error('No transaction rows were found. Check the header row in the mapping step.');
  await ImportJob.updateOne({ _id: job._id }, { $set: { 'progress.phase': 'classifying', 'progress.total': total, notes: job.notes } });

  const classifier = await createClassifier(auth);
  const now = new Date();
  const seenInFile = new Map<string, number>();
  if (job.cursor > 0) {
    // resuming: rebuild the in-file fingerprint counts from what was already staged
    const staged = await ImportRecord.aggregate<{ _id: string; n: number }>([
      { $match: { jobId: job._id, 'draft.fingerprint': { $exists: true } } },
      { $group: { _id: '$draft.fingerprint', n: { $sum: 1 } } },
    ]);
    for (const s of staged) seenInFile.set(s._id, s.n);
  }

  for (let start = job.cursor; start < total; start += BATCH) {
    const slice = dataRows.slice(start, start + BATCH);
    const parsed: ParsedRow[] = [];
    for (let i = 0; i < slice.length; i++) {
      const cells = slice[i] as string[];
      if (cells.every((c) => !String(c ?? '').trim())) continue; // genuinely blank line
      parsed.push(parseRow(cells, start + i, header, mapping, auth.tz, now, job.headerRow + 1));
    }

    const good = parsed.filter((p) => p.issues.length === 0);
    const recs = await classifier.classifyAll(
      good.map((p) => ({ merchant: p.merchant, description: p.description, direction: p.direction ?? null })),
    );

    // existing fingerprints, for exact-duplicate detection (multiset: first N rows match N existing)
    const drafts = new Map<number, TransactionDraft & { fingerprint: string; refundOfIdStr: string | null }>();
    for (let i = 0; i < good.length; i++) {
      const p = good[i] as ParsedRow;
      const rec = recs[i] as (typeof recs)[number];
      const direction = p.direction as 'debit' | 'credit';
      let type: TransactionType = direction === 'debit' ? 'expense' : 'income';
      if (direction === 'debit') {
        if (rec.typeHint === 'transfer') type = 'transfer';
      } else if (rec.typeHint === 'refund' || rec.typeHint === 'income' || rec.typeHint === 'transfer') type = rec.typeHint;
      else if (mapping.kind === 'credit_card_statement') type = 'refund';

      let category = rec.category;
      if (!category && p.categoryText) {
        const wanted = p.categoryText.toLowerCase();
        category = [...classifier.lookups.categories.values()].find((c) => c.slug === wanted || c.name.toLowerCase() === wanted)?.slug ?? null;
      }
      if (!category) category = type === 'income' ? 'income' : type === 'transfer' ? 'transfers' : null;

      const narration = p.description ? parseNarration(p.description) : null;
      const channelMethod: PaymentMethod | null =
        rec.channel === 'upi' ? 'upi' : rec.channel === 'pos' || rec.channel === 'ecom' ? (mapping.kind === 'credit_card_statement' ? 'credit_card' : 'debit_card') : rec.channel === 'atm' ? 'debit_card' : ['neft', 'imps', 'rtgs', 'ach', 'cheque'].includes(rec.channel) ? 'bank_transfer' : null;
      const paymentMethod = (p.paymentText ? inferPaymentMethod(p.paymentText) : null) ?? channelMethod ?? mapping.defaultPaymentMethod;
      const externalRef = p.reference ?? (rec.channel === 'upi' ? (narration?.reference ?? null) : null);

      const merchantKey = rec.merchantKey;
      const fingerprint = baseFingerprint({ dateKey: localDateKey(p.date as Date, auth.tz), amountPaise: p.amountPaise as number, type, merchantKey, externalRef });
      drafts.set(p.index, {
        merchantName: rec.merchantName,
        merchantKey,
        platform: rec.platform,
        amountPaise: p.amountPaise as number,
        date: p.date as Date,
        hasTime: Boolean(p.hasTime),
        category,
        subcategory: rec.subcategory,
        paymentMethod,
        type,
        status: 'completed',
        description: truncate(p.description, 500),
        notes: '',
        tags: [],
        externalRef: externalRef ? externalRef.slice(0, 80) : null,
        refundOfId: null,
        importSource: 'csv',
        classification: { source: rec.source, confidence: rec.confidence, reason: rec.reason, needsReview: rec.needsReview, ruleId: rec.ruleId },
        fingerprint,
        refundOfIdStr: null,
      });
    }

    const fps = [...new Set([...drafts.values()].map((d) => d.fingerprint))];
    const existing = fps.length
      ? await Transaction.aggregate<{ _id: string; n: number; id: Types.ObjectId; merchantName: string; date: Date; amountPaise: number }>([
          { $match: { userId: auth.userId, fingerprint: { $in: fps } } },
          { $group: { _id: '$fingerprint', n: { $sum: 1 }, id: { $first: '$_id' }, merchantName: { $first: '$merchantName' }, date: { $first: '$date' }, amountPaise: { $first: '$amountPaise' } } },
        ])
      : [];
    const existingByFp = new Map(existing.map((e) => [e._id, e]));

    // fuzzy candidates: same amount within ±1 day
    const amounts = [...new Set([...drafts.values()].map((d) => d.amountPaise))];
    const times = [...drafts.values()].map((d) => d.date.getTime());
    const candidates = amounts.length
      ? await Transaction.find({
          userId: auth.userId,
          amountPaise: { $in: amounts },
          date: { $gte: new Date(Math.min(...times) - 30 * 3_600_000), $lte: new Date(Math.max(...times) + 30 * 3_600_000) },
        })
          .select('amountPaise type merchantKey date externalRef hasTime merchantName fingerprint')
          .limit(50_000)
          .lean()
      : [];
    const candByAmount = new Map<number, typeof candidates>();
    for (const c of candidates) {
      const list = candByAmount.get(c.amountPaise) ?? [];
      list.push(c);
      candByAmount.set(c.amountPaise, list);
    }

    const records: Array<Omit<ImportRecordDoc, '_id'>> = [];
    const errors: Array<Omit<ImportErrorDoc, '_id' | 'createdAt'>> = [];
    const expiresAt = new Date(Date.now() + RECORD_TTL_MS);

    for (const p of parsed) {
      const base = { jobId: job._id, userId: auth.userId, rowNumber: p.rowNumber, raw: p.raw, expiresAt, importedTransactionId: null, importError: null };
      const d = drafts.get(p.index);
      if (p.issues.length > 0 || !d) {
        records.push({ ...base, status: 'invalid', decision: 'rejected', draft: null, classification: null, issues: p.issues, duplicateOf: null, merchantKey: null });
        for (const issue of p.issues) errors.push({ jobId: job._id, userId: auth.userId, rowNumber: p.rowNumber, code: issue.code, message: issue.message, field: issue.field ?? null, raw: p.raw });
        continue;
      }

      const issues: Issue[] = [];
      let status: ImportRecordDoc['status'] = d.classification.needsReview ? 'uncertain' : 'valid';
      let decision: ImportRecordDoc['decision'] = 'accepted';
      let duplicateOf: ImportRecordDoc['duplicateOf'] = null;

      const nExisting = existingByFp.get(d.fingerprint)?.n ?? 0;
      const seen = seenInFile.get(d.fingerprint) ?? 0;
      seenInFile.set(d.fingerprint, seen + 1);
      if (seen < nExisting) {
        const e = existingByFp.get(d.fingerprint) as NonNullable<ReturnType<typeof existingByFp.get>>;
        status = 'duplicate';
        decision = 'rejected';
        duplicateOf = { id: e.id, merchantName: e.merchantName, date: e.date, amountPaise: e.amountPaise };
        issues.push({ code: 'EXACT_DUPLICATE', message: 'Already in your transactions (same date, amount and merchant). Skipped unless you choose otherwise.' });
      } else {
        let best: { c: (typeof candidates)[number]; score: number; reasons: string[] } | null = null;
        for (const c of candByAmount.get(d.amountPaise) ?? []) {
          if (c.fingerprint === d.fingerprint) continue;
          const s = scoreDuplicate(
            { date: d.date, amountPaise: d.amountPaise, type: d.type, merchantKey: d.merchantKey, externalRef: d.externalRef, hasTime: d.hasTime },
            { date: c.date, amountPaise: c.amountPaise, type: c.type, merchantKey: c.merchantKey, externalRef: c.externalRef, hasTime: c.hasTime },
            auth.tz,
          );
          if (s.level !== 'none' && (!best || s.score > best.score)) best = { c, score: s.score, reasons: s.reasons };
        }
        if (best) {
          status = 'duplicate';
          decision = 'pending';
          duplicateOf = { id: best.c._id, merchantName: best.c.merchantName, date: best.c.date, amountPaise: best.c.amountPaise };
          issues.push({ code: 'POSSIBLE_DUPLICATE', message: `May duplicate an existing transaction: ${best.reasons.join('; ')}. Decide whether to import it.` });
        }
      }

      if (d.type === 'refund' && status !== 'duplicate') {
        const original = await findRefundOriginal(auth, { platform: d.platform, merchantKey: d.merchantKey, amountPaise: d.amountPaise, date: d.date });
        if (original) {
          d.refundOfIdStr = original._id.toString();
          d.platform = d.platform ?? original.platform;
          d.category = d.category ?? original.category;
        } else {
          issues.push({ code: 'REFUND_UNLINKED', message: 'No matching purchase found for this refund. It will still reduce your net spending.' });
          if (status === 'valid') status = 'uncertain';
        }
      }
      if (d.classification.needsReview) issues.push({ code: 'REVIEW_CLASSIFICATION', message: d.classification.reason });

      const { fingerprint, refundOfIdStr, ...draftRest } = d;
      records.push({
        ...base,
        status,
        decision,
        draft: { ...draftRest, fingerprint, refundOfId: refundOfIdStr },
        classification: { source: d.classification.source, confidence: d.classification.confidence, reason: d.classification.reason, needsReview: d.classification.needsReview, ruleId: d.classification.ruleId },
        issues,
        duplicateOf,
        merchantKey: d.merchantKey,
      });
    }

    try {
      if (records.length) await ImportRecord.insertMany(records, { ordered: false });
    } catch (error) {
      // a resumed batch may re-insert rows that were already staged — those collisions are expected
      if ((error as { code?: number }).code !== 11000 && !(error as { writeErrors?: unknown[] }).writeErrors) throw error;
    }
    if (errors.length) await ImportError.insertMany(errors, { ordered: false }).catch(() => undefined);
    await classifier.recordHits();
    await ImportJob.updateOne({ _id: job._id }, { $set: { cursor: Math.min(total, start + BATCH), 'progress.processed': Math.min(total, start + BATCH) } });
    await tick();
  }

  await refreshStats(job);
  await ImportJob.updateOne(
    { _id: job._id },
    { $set: { status: 'ready_for_review', 'progress.phase': 'review', 'progress.processed': total, 'queue.state': 'idle', 'queue.task': null } },
  );
  await notify(auth, { type: 'import', title: 'Import ready to review', body: `${job.filename} has been processed. Check the results and confirm.`, link: `/import/${job._id.toString()}`, dedupeKey: `import-ready:${job._id.toString()}` });
}

/** Turns accepted staged records into transactions. Idempotent: a retry never inserts a row twice. */
export async function importJob(jobId: Types.ObjectId): Promise<void> {
  const job = await ImportJob.findById(jobId);
  if (!job || job.status === 'cancelled') return;
  const auth = await authFor(job.userId);
  const lk = await loadLookups(auth.userId);
  await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'importing', 'progress.phase': 'importing', error: null } });

  const source = job.kind === 'email_receipt' ? 'email' : job.kind === 'receipt' ? 'receipt' : job.fileType === 'pdf' ? 'pdf_statement' : job.kind === 'credit_card_statement' ? 'credit_card_statement' : job.kind === 'upi_export' ? 'upi_export' : job.kind === 'bank_statement' ? 'bank_statement' : job.fileType === 'xlsx' ? 'xlsx' : 'csv';
  const filter = { jobId: job._id, decision: 'accepted' as const, status: { $ne: 'invalid' as const }, importedTransactionId: null };
  const toDo = await ImportRecord.countDocuments(filter);
  await ImportJob.updateOne({ _id: job._id }, { $set: { 'progress.total': toDo, 'progress.processed': 0 } });

  let done = 0;
  let failed = 0;
  for (;;) {
    const batch = await ImportRecord.find(filter).sort({ rowNumber: 1 }).limit(BATCH).lean();
    if (batch.length === 0) break;
    const docs = batch.map((r) => {
      const d = r.draft as Record<string, unknown>;
      const refundRef = typeof d.refundOfId === 'string' ? new Types.ObjectId(d.refundOfId) : null;
      const draft: TransactionDraft = {
        merchantName: d.merchantName as string,
        merchantKey: d.merchantKey as string,
        platform: (d.platform as string | null) ?? null,
        amountPaise: d.amountPaise as number,
        date: new Date(d.date as Date),
        hasTime: Boolean(d.hasTime),
        category: (d.category as string | null) ?? null,
        subcategory: (d.subcategory as string | null) ?? null,
        paymentMethod: d.paymentMethod as PaymentMethod,
        type: d.type as TransactionType,
        status: 'completed',
        description: (d.description as string) ?? '',
        notes: '',
        tags: [],
        externalRef: (d.externalRef as string | null) ?? null,
        refundOfId: refundRef,
        importSource: source,
        importJobId: job._id,
        importRowNumber: r.rowNumber,
        classification: r.classification as TransactionDraft['classification'],
      };
      const doc = toTransactionDoc(auth, draft, lk);
      if (job.kind === 'receipt' || job.fileType === 'image') {
        doc.receipt = { fileId: job.storageKey, filename: job.filename, mimeType: 'image/jpeg', size: job.sizeBytes };
      }
      return { record: r, doc: { ...doc, _id: new Types.ObjectId() } };
    });

    const result = await Transaction.insertMany(docs.map((x) => x.doc), { ordered: false }).catch((error: { writeErrors?: Array<{ index: number; err?: { code?: number; errmsg?: string } }>; code?: number }) => {
      if (error.writeErrors || error.code === 11000) return { error };
      throw error;
    });
    const failedIdx = new Set<number>();
    if ('error' in (result as object)) {
      for (const we of (result as { error: { writeErrors?: Array<{ index: number }> } }).error.writeErrors ?? []) failedIdx.add(we.index);
    }
    const ops = docs.map((x, i) => {
      if (failedIdx.has(i)) {
        failed++;
        // already imported by an earlier, interrupted attempt? link to it instead of failing the row
        return { updateOne: { filter: { _id: x.record._id }, update: { $set: { importError: 'This row was already imported or could not be saved' } } } };
      }
      done++;
      return { updateOne: { filter: { _id: x.record._id }, update: { $set: { importedTransactionId: x.doc._id, importError: null } } } };
    });
    // rows that collided on (importJobId, rowNumber) were imported by an earlier attempt — find and link them
    for (const idx of failedIdx) {
      const x = docs[idx] as (typeof docs)[number];
      const prior = await Transaction.findOne({ importJobId: job._id, importRowNumber: x.record.rowNumber }).select('_id').lean();
      if (prior) {
        failed--;
        done++;
        ops[idx] = { updateOne: { filter: { _id: x.record._id }, update: { $set: { importedTransactionId: prior._id, importError: null } } } };
      }
    }
    await ImportRecord.bulkWrite(ops);
    await ImportJob.updateOne({ _id: job._id }, { $set: { 'progress.processed': done + failed } });
    if (failed > 0 && done === 0) break; // nothing is going through: stop instead of looping forever
    await tick();
  }

  await refreshStats(job);
  const [invalid, importedCount] = await Promise.all([ImportRecord.countDocuments({ jobId: job._id, status: 'invalid' }), ImportRecord.countDocuments({ jobId: job._id, importedTransactionId: { $ne: null } })]);
  const stillFailing = await ImportRecord.countDocuments({ jobId: job._id, ...{ decision: 'accepted', status: { $ne: 'invalid' }, importedTransactionId: null } });
  await ImportJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: stillFailing > 0 || invalid > 0 ? 'completed_with_errors' : 'completed',
        'stats.imported': importedCount,
        'stats.failedToImport': stillFailing,
        'progress.phase': 'done',
        completedAt: new Date(),
        'queue.state': 'idle',
        'queue.task': null,
      },
    },
  );

  if (job.learn) await learnFromConfirmed(auth, job._id);
  void Promise.allSettled([runRecurringDetection(auth), checkBudgetAlerts(auth)]).then(() => undefined);
  await notify(auth, {
    type: 'import',
    severity: stillFailing > 0 ? 'warning' : 'success',
    title: stillFailing > 0 ? 'Import finished with problems' : 'Import complete',
    body: `${importedCount} transaction${importedCount === 1 ? '' : 's'} added from ${job.filename}${stillFailing > 0 ? `; ${stillFailing} could not be saved — you can retry.` : '.'}`,
    link: `/import/${job._id.toString()}`,
    dedupeKey: `import-done:${job._id.toString()}:${importedCount}:${stillFailing}`,
  });
}

/** Merchants whose uncertain classification the user accepted become learned rules, so they are not asked again. */
async function learnFromConfirmed(auth: AuthContext, jobId: Types.ObjectId): Promise<void> {
  const groups = await ImportRecord.aggregate<{ _id: string; name: string; platform: string | null; category: string | null; subcategory: string | null }>([
    { $match: { jobId, status: 'uncertain', decision: 'accepted', importedTransactionId: { $ne: null }, 'classification.needsReview': true, 'classification.source': { $in: ['alias', 'pattern', 'keyword', 'ai'] } } },
    { $group: { _id: '$merchantKey', name: { $first: '$draft.merchantName' }, platform: { $first: '$draft.platform' }, category: { $first: '$draft.category' }, subcategory: { $first: '$draft.subcategory' } } },
    { $limit: 50 },
  ]);
  for (const g of groups) {
    if (!g.platform && !g.category) continue;
    const suggestion = suggestRuleFromMerchant(g._id, g.name);
    if (!suggestion) continue;
    if (await MerchantRule.exists({ userId: auth.userId, pattern: suggestion.pattern, matchType: 'contains' })) continue;
    await MerchantRule.create({ userId: auth.userId, name: suggestion.name, matchType: 'contains', pattern: suggestion.pattern, field: 'any', platform: g.platform, category: g.category, subcategory: g.subcategory, priority: 100, source: 'learned' });
  }
}

/** Removes every transaction a job created and returns its records to the review stage. */
export async function rollbackJob(jobId: Types.ObjectId): Promise<void> {
  const job = await ImportJob.findById(jobId);
  if (!job) return;
  const auth = await authFor(job.userId);
  await Transaction.deleteMany({ userId: auth.userId, importJobId: job._id });
  await ImportRecord.updateMany({ jobId: job._id }, { $set: { importedTransactionId: null, importError: null } });
  await refreshStats(job);
  await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'ready_for_review', 'progress.phase': 'review', 'stats.imported': 0, 'stats.failedToImport': 0, completedAt: null, 'queue.state': 'idle', 'queue.task': null } });
  logger.info({ jobId: job._id.toString() }, 'Import rolled back');
}


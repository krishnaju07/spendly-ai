import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  baseFingerprint,
  localDateKey,
  scoreDuplicate,
  suggestRuleFromMerchant,
  type ClassificationSource,
  type ImportSource,
  type PaymentMethod,
  type Recognition,
  type TransactionStatus,
  type TransactionType,
  type transactionInputSchema,
  type transactionUpdateSchema,
} from '@spendly/shared';
import { badRequest, notFound } from '../lib/errors';
import type { AuthContext } from '../middleware/context';
import { MerchantRule, Transaction, type TransactionDoc } from '../models/finance';
import { deleteFile } from './files';
import { createClassifier } from './classify';
import type { Lookups } from './lookups';
import { loadLookups } from './lookups';

type NewTransaction = Omit<TransactionDoc, '_id' | 'createdAt' | 'updatedAt'>;

export interface TransactionDraft {
  merchantName: string;
  merchantKey: string;
  platform: string | null;
  amountPaise: number;
  date: Date;
  hasTime: boolean;
  category: string | null;
  subcategory: string | null;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  notes: string;
  tags: string[];
  externalRef: string | null;
  refundOfId: Types.ObjectId | null;
  importSource: ImportSource;
  importJobId?: Types.ObjectId | null;
  importRowNumber?: number | null;
  classification: { source: ClassificationSource; confidence: number; reason: string; needsReview: boolean; ruleId: string | null };
}

export function buildSearchText(
  d: Pick<TransactionDraft, 'merchantName' | 'platform' | 'category' | 'description' | 'notes' | 'tags' | 'amountPaise' | 'externalRef'>,
  lk: Lookups,
): string {
  const rupees = d.amountPaise / 100;
  return [
    d.merchantName,
    lk.platformName(d.platform),
    lk.categoryName(d.category),
    d.description,
    d.notes,
    d.tags.join(' '),
    d.externalRef,
    rupees.toFixed(2),
    String(Math.round(rupees)),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .slice(0, 1500);
}

export const classificationFrom = (r: Recognition): TransactionDraft['classification'] => ({
  source: r.source,
  confidence: r.confidence,
  reason: r.reason,
  needsReview: r.needsReview,
  ruleId: r.ruleId,
});

/** The one place a draft becomes a stored document, so fingerprints and search text are always set. */
export function toTransactionDoc(auth: Pick<AuthContext, 'userId' | 'tz' | 'user'>, d: TransactionDraft, lk: Lookups): NewTransaction {
  return {
    userId: auth.userId,
    merchantName: d.merchantName,
    merchantKey: d.merchantKey,
    platform: d.platform,
    amountPaise: d.amountPaise,
    currency: 'INR',
    date: d.date,
    hasTime: d.hasTime,
    category: d.category,
    subcategory: d.subcategory,
    paymentMethod: d.paymentMethod,
    type: d.type,
    status: d.status,
    description: d.description,
    notes: d.notes,
    tags: d.tags,
    receipt: null,
    importSource: d.importSource,
    externalRef: d.externalRef,
    importJobId: d.importJobId ?? null,
    importRowNumber: d.importRowNumber ?? null,
    fingerprint: baseFingerprint({
      dateKey: localDateKey(d.date, auth.tz),
      amountPaise: d.amountPaise,
      type: d.type,
      merchantKey: d.merchantKey,
      externalRef: d.externalRef,
    }),
    refundOfId: d.refundOfId,
    duplicateStatus: 'none',
    duplicateOfId: null,
    recurringPaymentId: null,
    classification: { ...d.classification, ruleId: d.classification.ruleId ? new Types.ObjectId(d.classification.ruleId) : null },
    searchText: buildSearchText(d, lk),
    isDemo: auth.user.isDemo,
  };
}

const DAY = 86_400_000;

/** Finds the purchase a refund most plausibly reverses: same merchant, recent, large enough, not already refunded. */
export async function findRefundOriginal(
  auth: Pick<AuthContext, 'userId'>,
  q: { platform: string | null; merchantKey: string; amountPaise: number; date: Date },
): Promise<TransactionDoc | null> {
  const who = [{ merchantKey: q.merchantKey }, ...(q.platform ? [{ platform: q.platform }] : [])];
  const candidates = await Transaction.find({
    userId: auth.userId,
    type: 'expense',
    status: 'completed',
    date: { $lte: q.date, $gte: new Date(q.date.getTime() - 120 * DAY) },
    amountPaise: { $gte: q.amountPaise },
    $or: who,
  })
    .sort({ date: -1 })
    .limit(15)
    .lean();
  if (candidates.length === 0) return null;
  const refunded = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { userId: auth.userId, type: 'refund', status: 'completed', refundOfId: { $in: candidates.map((c) => c._id) } } },
    { $group: { _id: '$refundOfId', total: { $sum: '$amountPaise' } } },
  ]);
  const refundedBy = new Map(refunded.map((r) => [r._id.toString(), r.total]));
  const open = candidates.filter((c) => c.amountPaise - (refundedBy.get(c._id.toString()) ?? 0) >= q.amountPaise);
  return open.find((c) => c.amountPaise === q.amountPaise) ?? open[0] ?? null;
}

/** Looks for an existing transaction this one may duplicate (same amount, ±1 day, similar merchant). */
export async function findPossibleDuplicate(
  auth: Pick<AuthContext, 'userId' | 'tz'>,
  d: Pick<TransactionDraft, 'amountPaise' | 'type' | 'date' | 'merchantKey' | 'externalRef' | 'hasTime'>,
  excludeId?: Types.ObjectId,
): Promise<{ doc: TransactionDoc; reasons: string[]; score: number } | null> {
  const candidates = await Transaction.find({
    userId: auth.userId,
    amountPaise: d.amountPaise,
    type: d.type,
    date: { $gte: new Date(d.date.getTime() - 30 * 3_600_000), $lte: new Date(d.date.getTime() + 30 * 3_600_000) },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .limit(10)
    .lean();
  let best: { doc: TransactionDoc; reasons: string[]; score: number } | null = null;
  for (const c of candidates) {
    const s = scoreDuplicate(
      { date: d.date, amountPaise: d.amountPaise, type: d.type, merchantKey: d.merchantKey, externalRef: d.externalRef, hasTime: d.hasTime },
      { date: c.date, amountPaise: c.amountPaise, type: c.type, merchantKey: c.merchantKey, externalRef: c.externalRef, hasTime: c.hasTime },
      auth.tz,
    );
    if (s.level !== 'none' && (!best || s.score > best.score)) best = { doc: c, reasons: s.reasons, score: s.score };
  }
  return best;
}

type CreateInput = z.output<typeof transactionInputSchema>;
type UpdateInput = z.output<typeof transactionUpdateSchema>;

function assertSlugs(lk: Lookups, platform: string | null | undefined, category: string | null | undefined) {
  if (platform && !lk.platforms.has(platform)) throw badRequest(`Unknown platform "${platform}"`, undefined, 'INVALID_PLATFORM');
  if (category && !lk.categories.has(category)) throw badRequest(`Unknown category "${category}"`, undefined, 'INVALID_CATEGORY');
}

export async function createTransaction(
  auth: AuthContext,
  input: CreateInput,
  /** Where the record came from, when it did not come from someone typing it in. */
  opts: { importSource?: ImportSource } = {},
): Promise<{ doc: TransactionDoc; warnings: string[] }> {
  const classifier = await createClassifier(auth);
  const lk = classifier.lookups;
  assertSlugs(lk, input.platform, input.category);

  const date = new Date(input.date);
  const direction = input.type === 'income' || input.type === 'refund' ? 'credit' : 'debit';
  const rec = classifier.classify({ merchant: input.merchantName, description: input.description, direction });

  const platformExplicit = input.platform !== undefined;
  const categoryExplicit = input.category !== undefined;
  const platform = platformExplicit ? (input.platform ?? null) : rec.platform;
  let category = categoryExplicit ? (input.category ?? null) : rec.category;
  let subcategory = input.subcategory ?? (categoryExplicit ? null : rec.subcategory);
  let merchantKey = platform ? `p:${platform}` : rec.merchantKey;

  const warnings: string[] = [];
  let refundOfId: Types.ObjectId | null = null;
  if (input.refundOfId) {
    const original = await Transaction.findOne({ _id: input.refundOfId, userId: auth.userId, type: 'expense' }).lean();
    if (!original) throw badRequest('The purchase this refund relates to was not found', undefined, 'INVALID_REFUND_LINK');
    refundOfId = original._id;
    if (!platformExplicit && !platform && original.platform) merchantKey = original.merchantKey;
    if (!categoryExplicit) category = original.category;
    subcategory = subcategory ?? original.subcategory;
  } else if (input.type === 'refund') {
    const original = await findRefundOriginal(auth, { platform, merchantKey, amountPaise: input.amountPaise, date });
    if (original) {
      refundOfId = original._id;
      if (!categoryExplicit) category = original.category;
      subcategory = subcategory ?? original.subcategory;
      if (!platformExplicit && !platform) merchantKey = original.merchantKey;
    } else warnings.push('No matching purchase was found to link this refund to. It still reduces your net spending.');
  }
  if (!category && input.type === 'income') category = 'income';
  if (!category && input.type === 'transfer') category = 'transfers';

  const explicit = platformExplicit || categoryExplicit;
  const draft: TransactionDraft = {
    merchantName: input.merchantName,
    merchantKey,
    platform,
    amountPaise: input.amountPaise,
    date,
    hasTime: input.hasTime,
    category,
    subcategory,
    paymentMethod: input.paymentMethod,
    type: input.type,
    status: input.status,
    description: input.description,
    notes: input.notes,
    tags: input.tags,
    externalRef: input.externalRef ?? null,
    refundOfId,
    importSource: opts.importSource ?? 'manual',
    classification: explicit
      ? { source: 'user', confidence: 1, reason: 'Set by you', needsReview: false, ruleId: null }
      : { ...classificationFrom(rec), needsReview: rec.needsReview || (!category && input.type === 'expense') },
  };

  const doc = toTransactionDoc(auth, draft, lk);
  const dup = await findPossibleDuplicate(auth, draft);
  if (dup) {
    doc.duplicateStatus = 'possible';
    doc.duplicateOfId = dup.doc._id;
    warnings.push(`This looks like a possible duplicate of an existing transaction (${dup.reasons.join('; ')}). Review it under Duplicates.`);
  }
  const created = await Transaction.create(doc);
  await classifier.recordHits();
  return { doc: created.toObject(), warnings };
}

export interface UpdateOutcome {
  doc: TransactionDoc;
  similarCount: number;
  suggestRule: { pattern: string; matchType: 'contains'; similarCount: number } | null;
  ruleId: string | null;
}

/** Statuses of classification the user has not personally confirmed — safe to improve in bulk. */
export const MACHINE_SOURCES: ClassificationSource[] = ['default', 'ai', 'alias', 'pattern', 'keyword'];

export async function updateTransaction(auth: AuthContext, id: string, patch: UpdateInput): Promise<UpdateOutcome> {
  const existing = await Transaction.findOne({ _id: id, userId: auth.userId });
  if (!existing) throw notFound('Transaction');
  const lk = await loadLookups(auth.userId);
  assertSlugs(lk, patch.platform, patch.category);

  const classificationChanged = patch.platform !== undefined || patch.category !== undefined;
  const before = { platform: existing.platform, category: existing.category };

  const set = <K extends keyof TransactionDoc>(key: K, value: TransactionDoc[K] | undefined) => {
    if (value !== undefined) existing.set(key, value);
  };
  set('merchantName', patch.merchantName);
  set('amountPaise', patch.amountPaise);
  if (patch.date) existing.date = new Date(patch.date);
  set('hasTime', patch.hasTime);
  set('type', patch.type);
  set('status', patch.status);
  set('paymentMethod', patch.paymentMethod);
  set('platform', patch.platform);
  set('category', patch.category);
  set('subcategory', patch.subcategory);
  set('description', patch.description);
  set('notes', patch.notes);
  set('tags', patch.tags);
  set('externalRef', patch.externalRef);

  if (patch.refundOfId !== undefined) {
    if (patch.refundOfId === null) existing.refundOfId = null;
    else {
      const original = await Transaction.findOne({ _id: patch.refundOfId, userId: auth.userId, type: 'expense' }).lean();
      if (!original) throw badRequest('The purchase this refund relates to was not found', undefined, 'INVALID_REFUND_LINK');
      existing.refundOfId = original._id;
    }
  }

  if (classificationChanged) {
    existing.classification = { source: 'user', confidence: 1, reason: 'Set by you', needsReview: false, ruleId: null };
    if (patch.platform !== undefined) existing.merchantKey = patch.platform ? `p:${patch.platform}` : existing.merchantKey;
  } else if (
    (patch.merchantName !== undefined || patch.description !== undefined) &&
    MACHINE_SOURCES.includes(existing.classification.source)
  ) {
    const classifier = await createClassifier(auth, lk);
    const rec = classifier.classify({
      merchant: existing.merchantName,
      description: existing.description,
      direction: existing.type === 'income' || existing.type === 'refund' ? 'credit' : 'debit',
    });
    existing.platform = rec.platform;
    existing.category = rec.category ?? existing.category;
    existing.subcategory = rec.subcategory ?? existing.subcategory;
    existing.merchantKey = rec.merchantKey;
    existing.classification = { ...classificationFrom(rec), ruleId: rec.ruleId ? new Types.ObjectId(rec.ruleId) : null };
  }

  existing.fingerprint = baseFingerprint({
    dateKey: localDateKey(existing.date, auth.tz),
    amountPaise: existing.amountPaise,
    type: existing.type,
    merchantKey: existing.merchantKey,
    externalRef: existing.externalRef,
  });
  existing.searchText = buildSearchText(existing, lk);
  await existing.save();

  const doc = existing.toObject();
  let similarCount = 0;
  let suggestRule: UpdateOutcome['suggestRule'] = null;
  let ruleId: string | null = null;

  const effective = classificationChanged && (doc.platform !== before.platform || doc.category !== before.category);
  if (effective) {
    similarCount = await Transaction.countDocuments({
      userId: auth.userId,
      merchantKey: doc.merchantKey,
      _id: { $ne: doc._id },
      'classification.source': { $in: MACHINE_SOURCES },
    });
    const suggestion = suggestRuleFromMerchant(doc.merchantKey, doc.merchantName);
    if (suggestion) suggestRule = { pattern: suggestion.pattern, matchType: 'contains', similarCount };

    if (patch.learn?.createRule && suggestion) {
      const rule = await MerchantRule.create({
        userId: auth.userId,
        name: suggestion.name,
        matchType: 'contains',
        pattern: suggestion.pattern,
        field: 'any',
        platform: doc.platform,
        category: doc.category,
        subcategory: doc.subcategory,
        priority: 100,
        source: 'learned',
      });
      ruleId = rule._id.toString();
      if (patch.learn.applyToSimilar) {
        await Transaction.updateMany(
          { userId: auth.userId, merchantKey: doc.merchantKey, _id: { $ne: doc._id }, 'classification.source': { $in: MACHINE_SOURCES } },
          {
            $set: {
              platform: doc.platform,
              category: doc.category,
              subcategory: doc.subcategory,
              classification: { source: 'learned_rule', confidence: 0.95, reason: `Applied from your correction of "${doc.merchantName}"`, needsReview: false, ruleId: rule._id },
            },
          },
        );
      }
    }
  }
  return { doc, similarCount, suggestRule: patch.learn?.createRule ? null : suggestRule, ruleId };
}

export async function deleteTransaction(auth: AuthContext, id: string): Promise<void> {
  const doc = await Transaction.findOneAndDelete({ _id: id, userId: auth.userId }).lean();
  if (!doc) throw notFound('Transaction');
  await Promise.all([
    Transaction.updateMany({ userId: auth.userId, refundOfId: doc._id }, { $set: { refundOfId: null } }),
    Transaction.updateMany({ userId: auth.userId, duplicateOfId: doc._id }, { $set: { duplicateOfId: null, duplicateStatus: 'none' } }),
    deleteFile(doc.receipt?.fileId),
  ]);
}

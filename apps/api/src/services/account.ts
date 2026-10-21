import { Types } from 'mongoose';
import {
  DEFAULT_TIMEZONE,
  generateDemoTransactions,
  type PreferencesDto,
  type UserDto,
} from '@spendly/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import type { AuthContext } from '../middleware/context';
import { Notification, OtpChallenge, ProviderConnection, ProviderFlow, Session, User, UserPreference, type UserDoc, type UserPreferenceDoc } from '../models/account';
import { Category, MerchantRule, Platform, Transaction } from '../models/finance';
import { ImportError, ImportJob, ImportRecord } from '../models/imports';
import { AIInsight, Budget, RecurringPayment, SavingsGoal } from '../models/planning';
import { createClassifier } from './classify';
import { deleteUserFiles } from './files';
import { toTransactionDoc, type TransactionDraft } from './transactions';
import { refreshInsights } from './insights';
import { runRecurringDetection } from './recurring';

export const toUserDto = (u: UserDoc): UserDto => ({
  id: u._id.toString(),
  phone: u.phone ?? null,
  name: u.name,
  isDemo: u.isDemo,
  demoExpiresAt: u.demoExpiresAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

export const toPreferencesDto = (p: UserPreferenceDoc): PreferencesDto => ({
  theme: p.theme,
  timezone: p.timezone,
  currency: 'INR',
  dateFormat: p.dateFormat,
  weekStartsOn: p.weekStartsOn,
  incomeTracking: p.incomeTracking,
  defaultRange: p.defaultRange as PreferencesDto['defaultRange'],
  ai: {
    enabled: p.ai.enabled,
    shareMerchantNames: p.ai.shareMerchantNames,
    classifyUnknownMerchants: p.ai.classifyUnknownMerchants,
    readReceipts: p.ai.readReceipts,
  },
  notifications: { ...p.notifications },
  consents: { emailImport: p.consents.emailImport },
  // preferences saved before tracking existed have no such field
  tracking: { platforms: p.tracking?.platforms ?? [], consentedAt: p.tracking?.consentedAt?.toISOString() ?? null },
  onboardingCompleted: p.onboardingCompleted,
});

/** Removes every record the user owns, across all collections, plus their stored files. */
export async function deleteAllUserData(userId: Types.ObjectId): Promise<void> {
  const owner = await User.findById(userId).select('phone').lean();
  await Promise.all([
    owner?.phone ? OtpChallenge.deleteMany({ phone: owner.phone }) : undefined,
    Transaction.deleteMany({ userId }),
    Platform.deleteMany({ userId }),
    Category.deleteMany({ userId }),
    MerchantRule.deleteMany({ userId }),
    Budget.deleteMany({ userId }),
    RecurringPayment.deleteMany({ userId }),
    SavingsGoal.deleteMany({ userId }),
    ImportJob.deleteMany({ userId }),
    ImportRecord.deleteMany({ userId }),
    ImportError.deleteMany({ userId }),
    AIInsight.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    Session.deleteMany({ userId }),
    ProviderConnection.deleteMany({ userId }),
    ProviderFlow.deleteMany({ userId }),
    UserPreference.deleteMany({ userId }),
    deleteUserFiles(userId),
  ]);
  await User.deleteOne({ _id: userId });
}

export async function purgeExpiredDemos(): Promise<number> {
  const expired = await User.find({ isDemo: true, demoExpiresAt: { $lt: new Date() } }).select('_id').lean();
  for (const u of expired) await deleteAllUserData(u._id);
  if (expired.length) logger.info({ count: expired.length }, 'Purged expired demo workspaces');
  return expired.length;
}

/**
 * Builds a throwaway, clearly flagged demo workspace with realistic sample data. Demo data lives
 * only in these isolated accounts — it can never be mixed into a real user's transactions.
 */
export async function createDemoWorkspace(now = new Date()): Promise<UserDoc> {
  const user = await User.create({
    name: 'Demo explorer',
    isDemo: true,
    demoExpiresAt: new Date(now.getTime() + env.demoTtlMs),
  });
  const prefs = await UserPreference.create({ userId: user._id, timezone: DEFAULT_TIMEZONE, onboardingCompleted: true });
  const auth: AuthContext = {
    userId: user._id,
    user: user.toObject(),
    prefs: prefs.toObject(),
    sessionId: new Types.ObjectId(),
    sessionTokenHash: '',
    tz: DEFAULT_TIMEZONE,
    weekStartsOn: 1,
  };

  const classifier = await createClassifier(auth);
  const demo = generateDemoTransactions({ now, tz: DEFAULT_TIMEZONE });
  const ids = demo.map(() => new Types.ObjectId());

  const docs = demo.map((t, i) => {
    // run the real recognition engine so demo rows carry honest classification metadata
    const rec = classifier.classify({
      merchant: t.merchantName,
      description: t.description,
      direction: t.type === 'income' || t.type === 'refund' ? 'credit' : 'debit',
    });
    const agrees = rec.platform === t.platform && rec.category === t.category;
    const draft: TransactionDraft = {
      merchantName: t.merchantName,
      merchantKey: t.platform ? `p:${t.platform}` : rec.merchantKey,
      platform: t.platform,
      amountPaise: t.amountPaise,
      date: t.date,
      hasTime: t.hasTime,
      category: t.category,
      subcategory: t.subcategory,
      paymentMethod: t.paymentMethod,
      type: t.type,
      status: 'completed',
      description: t.description,
      notes: '',
      tags: t.tags ?? [],
      externalRef: t.externalRef ?? null,
      refundOfId: t.refundOfIndex !== undefined ? (ids[t.refundOfIndex] ?? null) : null,
      importSource: 'demo',
      classification: agrees
        ? { source: rec.source, confidence: rec.confidence, reason: rec.reason, needsReview: false, ruleId: null }
        : { source: 'user', confidence: 1, reason: 'Demo data', needsReview: false, ruleId: null },
    };
    return { ...toTransactionDoc(auth, draft, classifier.lookups), _id: ids[i] as Types.ObjectId };
  });

  // mark the double charge so the duplicate review flow has something to show
  const dupIndex = docs.findIndex((d, i) => d.tags.includes('possible duplicate') && i > 0);
  if (dupIndex > 0) {
    const d = docs[dupIndex];
    const prev = docs[dupIndex - 1];
    if (d && prev) {
      d.duplicateStatus = 'possible';
      d.duplicateOfId = prev._id;
    }
  }
  for (let i = 0; i < docs.length; i += 500) await Transaction.insertMany(docs.slice(i, i + 500), { ordered: false });

  await Budget.insertMany([
    { userId: user._id, name: 'Monthly spending', scope: 'overall', period: 'monthly', amountPaise: 12_000_000, alertThresholds: [50, 80, 100] },
    { userId: user._id, name: 'Food delivery', scope: 'category', category: 'food-delivery', period: 'monthly', amountPaise: 500_000, alertThresholds: [50, 80, 100] },
    { userId: user._id, name: 'Entertainment', scope: 'category', category: 'entertainment', period: 'monthly', amountPaise: 300_000, alertThresholds: [80, 100] },
  ]);
  const target = new Date(now.getTime() + 14 * 30 * 86_400_000).toISOString().slice(0, 10);
  await SavingsGoal.create({
    userId: user._id,
    name: 'Emergency fund',
    type: 'emergency',
    targetAmountPaise: 30_000_000,
    savedAmountPaise: 12_000_000,
    targetDate: target,
    contributions: [
      { amountPaise: 1_000_000, date: new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10), note: 'Monthly SIP top-up' },
      { amountPaise: 1_000_000, date: new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10), note: 'Monthly SIP top-up' },
    ],
  });

  await runRecurringDetection(auth, now);
  await refreshInsights(auth, classifier.lookups, now);
  return user.toObject();
}

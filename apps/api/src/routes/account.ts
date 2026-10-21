import { once } from 'node:events';
import { Router } from 'express';
import type { z } from 'zod';
import { deleteAccountSchema, isValidTimezone, preferencesUpdateSchema, type IntegrationDto } from '@spendly/shared';
import { env } from '../config/env';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { clearSessionCookies } from '../middleware/auth';
import { authOf } from '../middleware/context';
import { exportLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { Notification, UserPreference } from '../models/account';
import { Category, MerchantRule, Platform, Transaction } from '../models/finance';
import { ImportJob } from '../models/imports';
import { AIInsight, Budget, RecurringPayment, SavingsGoal } from '../models/planning';
import { getProvider } from '../ai/providers';
import { deleteAllUserData, toPreferencesDto, toUserDto } from '../services/account';
import { checkCode, spendCode } from '../services/otp';
import { ensureUpcomingReminders } from '../services/recurring';
import { loadLookups } from '../services/lookups';
import { objectIdParam } from '../services/query';
import { toNotificationDto, unreadCount } from '../services/notifications';

// ── notifications ──────────────────────────────────────────────────────────────────────────────

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  await ensureUpcomingReminders(auth, await loadLookups(auth.userId)).catch(() => undefined);
  const [items, unread] = await Promise.all([Notification.find({ userId: auth.userId }).sort({ createdAt: -1 }).limit(40).lean(), unreadCount(auth.userId)]);
  res.json({ data: { items: items.map(toNotificationDto), unread } });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await Notification.updateMany({ userId: authOf(req).userId, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ data: { ok: true } });
});

notificationsRouter.patch('/:id/read', validate({ params: objectIdParam }), async (req, res) => {
  const result = await Notification.updateOne({ _id: req.valid.params.id, userId: authOf(req).userId }, { $set: { readAt: new Date() } });
  if (result.matchedCount === 0) throw notFound('Notification');
  res.json({ data: { ok: true } });
});

notificationsRouter.delete('/:id', validate({ params: objectIdParam }), async (req, res) => {
  await Notification.deleteOne({ _id: req.valid.params.id, userId: authOf(req).userId });
  res.json({ data: { ok: true } });
});

// ── settings ───────────────────────────────────────────────────────────────────────────────────

export const settingsRouter = Router();

settingsRouter.get('/preferences', (req, res) => {
  res.json({ data: toPreferencesDto(authOf(req).prefs) });
});

settingsRouter.patch('/preferences', validate({ body: preferencesUpdateSchema }), async (req, res) => {
  const auth = authOf(req);
  const b = req.valid.body as z.output<typeof preferencesUpdateSchema>;
  if (b.timezone && !isValidTimezone(b.timezone)) throw badRequest('Unknown timezone', undefined, 'INVALID_TIMEZONE');
  const set: Record<string, unknown> = {};
  for (const key of ['theme', 'timezone', 'dateFormat', 'weekStartsOn', 'incomeTracking', 'defaultRange', 'onboardingCompleted'] as const) {
    if (b[key] !== undefined) set[key] = b[key];
  }
  for (const [group, values] of [['ai', b.ai], ['notifications', b.notifications], ['consents', b.consents]] as const) {
    for (const [k, v] of Object.entries(values ?? {})) if (v !== undefined) set[`${group}.${k}`] = v;
  }
  // record *when* the user opted in, so consent is auditable
  if (b.ai?.enabled === true && !auth.prefs.ai.enabled) set['ai.consentedAt'] = new Date();
  if (b.ai?.enabled === false) Object.assign(set, { 'ai.shareMerchantNames': false, 'ai.classifyUnknownMerchants': false, 'ai.readReceipts': false });
  if (b.consents?.emailImport === true && !auth.prefs.consents.emailImport) set['consents.emailImportAt'] = new Date();
  // every saved list is a fresh, dated consent; an empty list withdraws it
  if (b.tracking) Object.assign(set, { 'tracking.platforms': b.tracking.platforms, 'tracking.consentedAt': b.tracking.platforms.length ? new Date() : null });
  const prefs = await UserPreference.findOneAndUpdate({ userId: auth.userId }, { $set: set }, { returnDocument: 'after' }).lean();
  if (!prefs) throw notFound('Preferences');
  res.json({ data: toPreferencesDto(prefs) });
});

/** A complete, machine-readable copy of everything stored about the user. Transactions are streamed. */
settingsRouter.get('/export', exportLimiter, async (req, res) => {
  const auth = authOf(req);
  const userId = auth.userId;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spendly-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Cache-Control', 'private, no-store');

  const small = async () => ({
    user: toUserDto(auth.user),
    preferences: toPreferencesDto(auth.prefs),
    customPlatforms: await Platform.find({ userId }).lean(),
    customCategories: await Category.find({ userId }).lean(),
    rules: await MerchantRule.find({ userId }).lean(),
    budgets: await Budget.find({ userId }).lean(),
    recurringPayments: await RecurringPayment.find({ userId }).lean(),
    savingsGoals: await SavingsGoal.find({ userId }).lean(),
    insights: await AIInsight.find({ userId }).lean(),
    notifications: await Notification.find({ userId }).lean(),
    importHistory: await ImportJob.find({ userId }).select('-sampleRows -storageKey').lean(),
  });
  const meta = await small();
  const head = JSON.stringify({ exportedAt: new Date().toISOString(), format: 'spendly-export/1', note: 'Amounts are integer paise (1 INR = 100 paise).', ...meta });
  res.write(`${head.slice(0, -1)},"transactions":[`);
  let first = true;
  for await (const t of Transaction.find({ userId }).sort({ date: 1 }).lean().cursor()) {
    const ok = res.write(`${first ? '' : ','}${JSON.stringify({ ...t, searchText: undefined })}`);
    first = false;
    if (!ok) await once(res, 'drain');
  }
  res.end(']}');
});

settingsRouter.delete('/account', validate({ body: deleteAccountSchema }), async (req, res) => {
  const auth = authOf(req);
  const { otp } = req.valid.body as z.output<typeof deleteAccountSchema>;
  if (!auth.user.isDemo) {
    // a signed-in session alone is not enough to erase everything: it also needs a fresh code texted to the owner
    if (!auth.user.phone) throw forbidden('This account has no mobile number to confirm with.');
    if (!otp) throw new AppError(400, 'CODE_REQUIRED', 'Enter the code we texted you to confirm.');
    await spendCode(await checkCode(auth.user.phone, otp));
  }
  await deleteAllUserData(auth.userId);
  clearSessionCookies(res);
  res.json({ data: { ok: true } });
});

// ── integrations (honest status; nothing here syncs without authorization) ─────────────────────

export const integrationsRouter = Router();

integrationsRouter.get('/', (req, res) => {
  const auth = authOf(req);
  const ai = getProvider();
  const gmailKeys = Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET);
  const items: IntegrationDto[] = [
    {
      id: 'file-import',
      name: 'Statement & CSV/XLSX import',
      description: 'Upload bank, credit-card or UPI statements (CSV, XLSX, text-based PDF). You review everything before it is saved.',
      status: 'available',
      statusLabel: 'Available now',
      requires: [],
      consentRequired: false,
      consentGranted: true,
    },
    {
      id: 'email-eml',
      name: 'Receipt emails (.eml files)',
      description: 'Export a receipt email as an .eml file and upload it. Spendly reads the amount, date and sender — nothing is fetched from your mailbox.',
      status: 'available',
      statusLabel: 'Available now',
      requires: [],
      consentRequired: false,
      consentGranted: true,
    },
    {
      id: 'receipt-ai',
      name: 'Receipt image reading (AI)',
      description: 'Reads merchant, date and total from a receipt photo using your configured AI provider. Off unless you enable it.',
      status: ai ? 'available' : 'not_configured',
      statusLabel: ai ? (auth.prefs.ai.enabled && auth.prefs.ai.readReceipts ? 'Enabled' : 'Available — enable in Settings → AI & privacy') : 'Not configured',
      requires: ai ? [] : ['An AI provider (AI_PROVIDER and AI_API_KEY on the server)'],
      consentRequired: true,
      consentGranted: auth.prefs.ai.enabled && auth.prefs.ai.readReceipts,
    },
    {
      id: 'gmail',
      name: 'Gmail receipt sync',
      description: 'Would read receipt emails from a mailbox you explicitly authorise. Not implemented in this version; use .eml import.',
      status: gmailKeys ? 'unavailable' : 'not_configured',
      statusLabel: gmailKeys ? 'Credentials found, connector not built yet' : 'Not configured',
      requires: ['Google Cloud OAuth client (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET)', 'Your explicit consent'],
      consentRequired: true,
      consentGranted: auth.prefs.consents.emailImport,
    },
    {
      id: 'account-aggregator',
      name: 'Direct bank sync (Account Aggregator)',
      description: 'India’s Account Aggregator framework needs a registered financial-information user. Not available in a self-hosted build — import statements instead.',
      status: 'unavailable',
      statusLabel: 'Unavailable',
      requires: ['AA framework registration'],
      consentRequired: true,
      consentGranted: false,
    },
    {
      id: 'platform-apis',
      name: 'Zomato, Swiggy, Zepto, Blinkit, BookMyShow, District …',
      description: 'These services publish no API for a customer’s own order history, and Spendly never asks for your passwords or scrapes accounts. Their spending is recognised from your bank/UPI statements and receipts.',
      status: 'unavailable',
      statusLabel: 'No public API exists',
      requires: [],
      consentRequired: false,
      consentGranted: false,
    },
  ];
  res.json({ data: items });
});

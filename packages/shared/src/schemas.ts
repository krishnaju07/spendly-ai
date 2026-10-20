import { z } from 'zod';
import {
  DEFAULT_ALERT_THRESHOLDS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from './constants';
import { MAX_AMOUNT_PAISE } from './money';
import { RANGE_PRESETS } from './dates';
import { normalizePhone, OTP_LENGTH } from './phone';
import { RULE_FIELDS, RULE_MATCH_TYPES, validateRulePattern } from './rules';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const slug = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Invalid slug');
const paise = z.number().int().positive().max(MAX_AMOUNT_PAISE);
const shortText = (max: number) => z.string().trim().max(max);

// ── auth ───────────────────────────────────────────────────────────────────────────────────────

/** A mobile number as people type it; parsed to E.164 (`+919876543210`). */
export const phoneSchema = z
  .string()
  .trim()
  .max(40, 'Enter a 10-digit mobile number')
  .refine((v) => normalizePhone(v) !== null, 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9')
  .transform((v) => normalizePhone(v) as string);

const otpField = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);
const personName = z.string().trim().min(1, 'Enter your name').max(80);

export const otpRequestSchema = z.object({ phone: phoneSchema });
/** `name` is only needed the first time a number signs in; without it the server asks for it. */
export const otpVerifySchema = z.object({ phone: phoneSchema, otp: otpField, name: personName.optional() });

// ── transactions ───────────────────────────────────────────────────────────────────────────────

export const transactionInputSchema = z.object({
  merchantName: z.string().trim().min(1, 'Enter a merchant').max(120),
  amountPaise: paise,
  date: z.iso.datetime({ offset: true }),
  hasTime: z.boolean().default(true),
  type: z.enum(TRANSACTION_TYPES).default('expense'),
  status: z.enum(TRANSACTION_STATUSES).default('completed'),
  paymentMethod: z.enum(PAYMENT_METHODS).default('upi'),
  platform: slug.nullable().optional(),
  category: slug.nullable().optional(),
  subcategory: shortText(80).nullable().optional(),
  description: shortText(500).default(''),
  notes: shortText(2000).default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  externalRef: shortText(80).nullable().optional(),
  refundOfId: objectId.nullable().optional(),
});
export type TransactionInput = z.input<typeof transactionInputSchema>;

export const transactionUpdateSchema = transactionInputSchema
  .partial()
  .extend({
    /** Ask the server to remember a platform/category correction as a rule. */
    learn: z.object({ createRule: z.boolean().default(false), applyToSimilar: z.boolean().default(false) }).optional(),
  })
  .strict();

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('categorize'), ids: z.array(objectId).min(1).max(500), category: slug, subcategory: shortText(80).nullable().optional() }),
  z.object({ action: z.literal('set_platform'), ids: z.array(objectId).min(1).max(500), platform: slug.nullable() }),
  z.object({ action: z.literal('set_type'), ids: z.array(objectId).min(1).max(500), type: z.enum(TRANSACTION_TYPES) }),
  z.object({ action: z.literal('add_tag'), ids: z.array(objectId).min(1).max(500), tag: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal('delete'), ids: z.array(objectId).min(1).max(500) }),
  z.object({ action: z.literal('confirm_classification'), ids: z.array(objectId).min(1).max(500) }),
]);

export const duplicateResolveSchema = z.object({
  keepId: objectId,
  removeIds: z.array(objectId).min(1).max(20).default([]),
  /** When true the group is marked "not a duplicate" instead of deleting anything. */
  dismiss: z.boolean().default(false),
});

// ── platforms, categories, rules ───────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');

export const customPlatformSchema = z.object({
  name: z.string().trim().min(1).max(60),
  group: z.string().trim().min(1).max(60).default('Other'),
  color: hexColor.default('#64748B'),
  category: slug.nullable().optional(),
  aliases: z.array(z.string().trim().min(2).max(60)).max(20).default([]),
  website: z.url().max(200).nullable().optional(),
});

export const customCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['spending', 'income']).default('spending'),
  discretionary: z.boolean().default(false),
  subcategories: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const ruleInputSchema = z
  .object({
    name: shortText(80).optional(),
    matchType: z.enum(RULE_MATCH_TYPES).default('contains'),
    pattern: z.string().trim().min(1).max(160),
    field: z.enum(RULE_FIELDS).default('any'),
    platform: slug.nullable().optional(),
    category: slug.nullable().optional(),
    subcategory: shortText(80).nullable().optional(),
    type: z.enum(TRANSACTION_TYPES).nullable().optional(),
    priority: z.number().int().min(0).max(1000).default(100),
    isActive: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    const check = validateRulePattern(rule.matchType, rule.pattern);
    if (!check.ok) ctx.addIssue({ code: 'custom', path: ['pattern'], message: check.reason });
    if (!rule.platform && !rule.category && !rule.type) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose a platform, a category or a type for the rule to apply' });
    }
  });

// ── budgets, goals ─────────────────────────────────────────────────────────────────────────────

export const budgetInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scope: z.enum(['overall', 'category', 'platform']),
    period: z.enum(['monthly', 'weekly', 'custom']),
    amountPaise: paise,
    category: slug.nullable().optional(),
    platform: slug.nullable().optional(),
    startDate: isoDay.nullable().optional(),
    endDate: isoDay.nullable().optional(),
    alertThresholds: z.array(z.number().int().min(1).max(200)).min(1).max(5).default([...DEFAULT_ALERT_THRESHOLDS]),
    isActive: z.boolean().default(true),
  })
  .superRefine((b, ctx) => {
    if (b.scope === 'category' && !b.category) ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose a category' });
    if (b.scope === 'platform' && !b.platform) ctx.addIssue({ code: 'custom', path: ['platform'], message: 'Choose a platform' });
    if (b.period === 'custom') {
      if (!b.startDate || !b.endDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Choose a start and end date' });
      else if (b.endDate < b.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must not be before the start date' });
    }
  });

export const GOAL_TYPES = ['emergency', 'laptop', 'travel', 'vehicle', 'education', 'personal', 'custom'] as const;

export const goalInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(GOAL_TYPES).default('custom'),
  targetAmountPaise: paise,
  savedAmountPaise: z.number().int().min(0).max(MAX_AMOUNT_PAISE).default(0),
  targetDate: isoDay,
  notes: shortText(500).default(''),
});
export const contributionSchema = z.object({
  amountPaise: z.number().int().min(1).max(MAX_AMOUNT_PAISE),
  date: isoDay.optional(),
  note: shortText(200).default(''),
});

// ── recurring ──────────────────────────────────────────────────────────────────────────────────

export const recurringUpdateSchema = z.object({
  status: z.enum(['detected', 'confirmed', 'dismissed']).optional(),
  amountPaise: paise.optional(),
  nextExpectedDate: isoDay.nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(14).optional(),
});

// ── imports ────────────────────────────────────────────────────────────────────────────────────

export const IMPORT_KINDS = ['generic', 'bank_statement', 'credit_card_statement', 'upi_export'] as const;

export const importMappingSchema = z.object({
  kind: z.enum(IMPORT_KINDS).default('generic'),
  sheet: shortText(80).optional(),
  headerRow: z.number().int().min(0).max(200).default(0),
  columns: z.object({
    date: shortText(120),
    time: shortText(120).nullable().optional(),
    description: shortText(120).nullable().optional(),
    merchant: shortText(120).nullable().optional(),
    amount: shortText(120).nullable().optional(),
    debit: shortText(120).nullable().optional(),
    credit: shortText(120).nullable().optional(),
    drcr: shortText(120).nullable().optional(),
    reference: shortText(120).nullable().optional(),
    category: shortText(120).nullable().optional(),
    paymentMethod: shortText(120).nullable().optional(),
  }),
  dateOrder: z.enum(['dmy', 'mdy', 'ymd']).default('dmy'),
  /** How a single amount column encodes direction. */
  amountSign: z.enum(['negative_is_expense', 'positive_is_expense', 'all_expenses']).default('negative_is_expense'),
  defaultPaymentMethod: z.enum(PAYMENT_METHODS).default('bank_transfer'),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importRecordPatchSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'pending']).optional(),
  merchantName: shortText(120).optional(),
  amountPaise: paise.optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  platform: slug.nullable().optional(),
  category: slug.nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
});

export const importBulkDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  /** Which staged records to change. */
  filter: z.object({ status: z.enum(['valid', 'duplicate', 'uncertain', 'invalid']).optional(), merchantKey: shortText(160).optional() }),
});

export const importConfirmSchema = z.object({
  /** What to do with records still awaiting a decision. */
  pending: z.enum(['skip', 'import']).optional(),
  /** Create learned rules for merchants whose classification the user confirmed in review. */
  learnConfirmed: z.boolean().default(true),
});

// ── preferences ────────────────────────────────────────────────────────────────────────────────

export const preferencesUpdateSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    timezone: z.string().min(1).max(64),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
    weekStartsOn: z.union([z.literal(1), z.literal(7)]),
    incomeTracking: z.boolean(),
    defaultRange: z.enum(RANGE_PRESETS).refine((v) => v !== 'custom'),
    ai: z
      .object({
        /** Master switch: nothing is sent to an external AI provider while this is off. */
        enabled: z.boolean(),
        /** Let the provider see merchant names (otherwise only aggregated figures are sent). */
        shareMerchantNames: z.boolean(),
        /** Let the provider help classify merchants the rules cannot place. */
        classifyUnknownMerchants: z.boolean(),
        /** Let the provider read receipt images. */
        readReceipts: z.boolean(),
      })
      .partial(),
    notifications: z
      .object({ budgetAlerts: z.boolean(), upcomingPayments: z.boolean(), importUpdates: z.boolean(), insights: z.boolean() })
      .partial(),
    consents: z.object({ emailImport: z.boolean() }).partial(),
    onboardingCompleted: z.boolean(),
  })
  .partial();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

// ── AI ─────────────────────────────────────────────────────────────────────────────────────────

export const aiChatSchema = z.object({
  message: z.string().trim().min(2, 'Ask a question').max(500),
  /** Plan of the previous answer, so follow-ups like "and last month?" can reuse it. */
  previousPlan: z.unknown().optional(),
});

/** Deleting a real account is confirmed with a fresh sign-in code; the demo workspace needs none. */
export const deleteAccountSchema = z.object({ otp: otpField.optional(), confirm: z.literal('DELETE') });

import { Schema, model, type Types } from 'mongoose';
import {
  CLASSIFICATION_SOURCES,
  IMPORT_SOURCES,
  PAYMENT_METHODS,
  RULE_FIELDS,
  RULE_MATCH_TYPES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type ClassificationSource,
  type ImportSource,
  type OrderDetail,
  type PaymentMethod,
  type TransactionStatus,
  type TransactionType,
} from '@spendly/shared';

export interface TransactionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  merchantName: string;
  merchantKey: string;
  platform: string | null;
  amountPaise: number;
  currency: 'INR';
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
  receipt: { fileId: string; filename: string; mimeType: string; size: number } | null;
  importSource: ImportSource;
  /** What a linked order was: restaurant, area, dishes. Absent on everything else. */
  orderDetail: OrderDetail | null;
  externalRef: string | null;
  importJobId: Types.ObjectId | null;
  importRowNumber: number | null;
  fingerprint: string;
  refundOfId: Types.ObjectId | null;
  duplicateStatus: 'none' | 'possible' | 'dismissed';
  duplicateOfId: Types.ObjectId | null;
  recurringPaymentId: Types.ObjectId | null;
  classification: {
    source: ClassificationSource;
    confidence: number;
    reason: string;
    needsReview: boolean;
    ruleId: Types.ObjectId | null;
  };
  searchText: string;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<TransactionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    merchantName: { type: String, required: true, trim: true, maxlength: 120 },
    merchantKey: { type: String, required: true, maxlength: 200 },
    platform: { type: String, default: null, maxlength: 80 },
    amountPaise: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isSafeInteger(v) && v > 0, message: 'amountPaise must be a positive integer' },
    },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    date: { type: Date, required: true },
    hasTime: { type: Boolean, default: true },
    category: { type: String, default: null, maxlength: 80 },
    subcategory: { type: String, default: null, maxlength: 80 },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS], default: 'upi' },
    type: { type: String, enum: [...TRANSACTION_TYPES], default: 'expense' },
    status: { type: String, enum: [...TRANSACTION_STATUSES], default: 'completed' },
    description: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 2000 },
    tags: { type: [String], default: [] },
    receipt: {
      type: new Schema({ fileId: String, filename: String, mimeType: String, size: Number }, { _id: false }),
      default: null,
    },
    importSource: { type: String, enum: [...IMPORT_SOURCES], default: 'manual' },
    orderDetail: {
      type: new Schema(
        {
          place: { type: String, default: null, maxlength: 160 },
          area: { type: String, default: null, maxlength: 160 },
          items: [
            new Schema(
              { name: { type: String, required: true, maxlength: 120 }, quantity: { type: Number, default: 1, min: 1, max: 999 }, diet: { type: String, enum: ['veg', 'nonveg', 'egg', null], default: null } },
              { _id: false },
            ),
          ],
        },
        { _id: false },
      ),
      default: null,
    },
    externalRef: { type: String, default: null, maxlength: 80 },
    importJobId: { type: Schema.Types.ObjectId, default: null },
    importRowNumber: { type: Number, default: null },
    fingerprint: { type: String, required: true },
    refundOfId: { type: Schema.Types.ObjectId, default: null },
    duplicateStatus: { type: String, enum: ['none', 'possible', 'dismissed'], default: 'none' },
    duplicateOfId: { type: Schema.Types.ObjectId, default: null },
    recurringPaymentId: { type: Schema.Types.ObjectId, default: null },
    classification: {
      source: { type: String, enum: [...CLASSIFICATION_SOURCES], default: 'default' },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      reason: { type: String, default: '', maxlength: 400 },
      needsReview: { type: Boolean, default: false },
      ruleId: { type: Schema.Types.ObjectId, default: null },
    },
    searchText: { type: String, default: '' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, platform: 1, date: -1 });
transactionSchema.index({ userId: 1, category: 1, date: -1 });
transactionSchema.index({ userId: 1, merchantKey: 1, date: -1 });
transactionSchema.index({ userId: 1, fingerprint: 1 });
transactionSchema.index({ userId: 1, externalRef: 1 }, { partialFilterExpression: { externalRef: { $type: 'string' } } });
transactionSchema.index({ importJobId: 1 }, { partialFilterExpression: { importJobId: { $type: 'objectId' } } });
// makes a retried "confirm import" idempotent: the same staged row can only become one transaction
transactionSchema.index(
  { importJobId: 1, importRowNumber: 1 },
  { unique: true, partialFilterExpression: { importJobId: { $type: 'objectId' } } },
);
transactionSchema.index(
  { userId: 1, 'classification.needsReview': 1 },
  { partialFilterExpression: { 'classification.needsReview': true } },
);
transactionSchema.index({ userId: 1, refundOfId: 1 }, { partialFilterExpression: { refundOfId: { $type: 'objectId' } } });
transactionSchema.index({ userId: 1, duplicateStatus: 1 }, { partialFilterExpression: { duplicateStatus: 'possible' } });

export const Transaction = model<TransactionDoc>('Transaction', transactionSchema);

export interface PlatformDoc {
  _id: Types.ObjectId;
  /** null for the built-in directory, set for a user's custom platforms. */
  userId: Types.ObjectId | null;
  slug: string;
  name: string;
  group: string;
  kind: 'brand' | 'general';
  color: string;
  textColor: string;
  monogram: string;
  brandIcon: string | null;
  icon: string | null;
  category: string | null;
  website: string | null;
  aliases: string[];
  verification: 'verified' | 'probable' | 'custom';
  sources: Record<string, unknown>;
  note: string | null;
  isActive: boolean;
}

const platformSchema = new Schema<PlatformDoc>(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    slug: { type: String, required: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    group: { type: String, required: true, maxlength: 60 },
    kind: { type: String, enum: ['brand', 'general'], default: 'brand' },
    color: { type: String, default: '#64748B' },
    textColor: { type: String, default: '#FFFFFF' },
    monogram: { type: String, default: '?', maxlength: 3 },
    brandIcon: { type: String, default: null },
    icon: { type: String, default: null },
    category: { type: String, default: null },
    website: { type: String, default: null, maxlength: 200 },
    aliases: { type: [String], default: [] },
    verification: { type: String, enum: ['verified', 'probable', 'custom'], default: 'verified' },
    sources: { type: Schema.Types.Mixed, default: {} },
    note: { type: String, default: null, maxlength: 400 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
platformSchema.index({ userId: 1, slug: 1 }, { unique: true });

export const Platform = model<PlatformDoc>('Platform', platformSchema);

export interface CategoryDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId | null;
  slug: string;
  name: string;
  kind: 'spending' | 'income' | 'transfer';
  icon: string;
  slot: number | null;
  discretionary: boolean;
  subcategories: string[];
  isActive: boolean;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    slug: { type: String, required: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ['spending', 'income', 'transfer'], default: 'spending' },
    icon: { type: String, default: 'CircleEllipsis' },
    slot: { type: Number, default: null },
    discretionary: { type: Boolean, default: false },
    subcategories: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
categorySchema.index({ userId: 1, slug: 1 }, { unique: true });

export const Category = model<CategoryDoc>('Category', categorySchema);

export interface MerchantRuleDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  matchType: (typeof RULE_MATCH_TYPES)[number];
  pattern: string;
  field: (typeof RULE_FIELDS)[number];
  platform: string | null;
  category: string | null;
  subcategory: string | null;
  type: TransactionType | null;
  priority: number;
  isActive: boolean;
  source: 'user' | 'learned';
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const merchantRuleSchema = new Schema<MerchantRuleDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, default: '', maxlength: 80 },
    matchType: { type: String, enum: [...RULE_MATCH_TYPES], default: 'contains' },
    pattern: { type: String, required: true, maxlength: 160 },
    field: { type: String, enum: [...RULE_FIELDS], default: 'any' },
    platform: { type: String, default: null },
    category: { type: String, default: null },
    subcategory: { type: String, default: null },
    type: { type: String, enum: [...TRANSACTION_TYPES, null], default: null },
    priority: { type: Number, default: 100, min: 0, max: 1000 },
    isActive: { type: Boolean, default: true },
    source: { type: String, enum: ['user', 'learned'], default: 'user' },
    hitCount: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: null },
  },
  { timestamps: true },
);
merchantRuleSchema.index({ userId: 1, priority: -1 });

export const MerchantRule = model<MerchantRuleDoc>('MerchantRule', merchantRuleSchema);

import { Schema, model, type Types } from 'mongoose';

export interface BudgetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  scope: 'overall' | 'category' | 'platform';
  period: 'monthly' | 'weekly' | 'custom';
  amountPaise: number;
  category: string | null;
  platform: string | null;
  startDate: string | null;
  endDate: string | null;
  alertThresholds: number[];
  isActive: boolean;
  /** Highest threshold already notified for a given period, so alerts fire once per crossing. */
  lastAlert: { periodKey: string; threshold: number } | null;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<BudgetDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    scope: { type: String, enum: ['overall', 'category', 'platform'], required: true },
    period: { type: String, enum: ['monthly', 'weekly', 'custom'], required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    category: { type: String, default: null },
    platform: { type: String, default: null },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    alertThresholds: { type: [Number], default: [50, 80, 100] },
    isActive: { type: Boolean, default: true },
    lastAlert: { type: new Schema({ periodKey: String, threshold: Number }, { _id: false }), default: null },
  },
  { timestamps: true },
);
budgetSchema.index({ userId: 1, isActive: 1 });

export const Budget = model<BudgetDoc>('Budget', budgetSchema);

export interface RecurringPaymentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  merchantKey: string;
  displayName: string;
  platform: string | null;
  category: string | null;
  frequency: string;
  intervalDays: number;
  amountPaise: number;
  amountMinPaise: number;
  amountMaxPaise: number;
  amountVariable: boolean;
  occurrences: number;
  firstDate: Date;
  lastDate: Date;
  lastAmountPaise: number;
  nextExpectedDate: Date | null;
  possiblyInactive: boolean;
  priceChanges: Array<{ date: Date; fromPaise: number; toPaise: number }>;
  monthlyCostPaise: number;
  annualCostPaise: number;
  confidence: number;
  reasons: string[];
  transactionIds: Types.ObjectId[];
  status: 'detected' | 'confirmed' | 'dismissed';
  reminderDaysBefore: number;
  /** Values the user set by hand always win over re-detection. */
  overrides: { amountPaise: number | null; nextExpectedDate: Date | null };
  lastDetectedAt: Date;
}

const recurringSchema = new Schema<RecurringPaymentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    merchantKey: { type: String, required: true, maxlength: 200 },
    displayName: { type: String, required: true, maxlength: 120 },
    platform: { type: String, default: null },
    category: { type: String, default: null },
    frequency: { type: String, required: true },
    intervalDays: Number,
    amountPaise: Number,
    amountMinPaise: Number,
    amountMaxPaise: Number,
    amountVariable: Boolean,
    occurrences: Number,
    firstDate: Date,
    lastDate: Date,
    lastAmountPaise: Number,
    nextExpectedDate: { type: Date, default: null },
    possiblyInactive: { type: Boolean, default: false },
    priceChanges: { type: [new Schema({ date: Date, fromPaise: Number, toPaise: Number }, { _id: false })], default: [] },
    monthlyCostPaise: Number,
    annualCostPaise: Number,
    confidence: Number,
    reasons: { type: [String], default: [] },
    transactionIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['detected', 'confirmed', 'dismissed'], default: 'detected' },
    reminderDaysBefore: { type: Number, default: 2, min: 0, max: 14 },
    overrides: {
      amountPaise: { type: Number, default: null },
      nextExpectedDate: { type: Date, default: null },
    },
    lastDetectedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
recurringSchema.index({ userId: 1, merchantKey: 1 }, { unique: true });
recurringSchema.index({ userId: 1, status: 1, nextExpectedDate: 1 });

export const RecurringPayment = model<RecurringPaymentDoc>('RecurringPayment', recurringSchema);

export interface SavingsGoalDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  type: string;
  targetAmountPaise: number;
  /** Amount already saved when the goal was created; contributions are added on top. */
  savedAmountPaise: number;
  targetDate: string;
  notes: string;
  status: 'active' | 'completed';
  contributions: Array<{ _id: Types.ObjectId; amountPaise: number; date: string; note: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const goalSchema = new Schema<SavingsGoalDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, default: 'custom' },
    targetAmountPaise: { type: Number, required: true, min: 1 },
    savedAmountPaise: { type: Number, default: 0, min: 0 },
    targetDate: { type: String, required: true },
    notes: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    contributions: {
      type: [new Schema({ amountPaise: Number, date: String, note: { type: String, default: '' } })],
      default: [],
    },
  },
  { timestamps: true },
);
goalSchema.index({ userId: 1, status: 1 });

export const SavingsGoal = model<SavingsGoalDoc>('SavingsGoal', goalSchema);

export interface AIInsightDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  type: string;
  severity: 'info' | 'positive' | 'warning';
  title: string;
  summary: string;
  statements: Array<{ kind: string; text: string }>;
  evidence: Record<string, unknown>;
  confidence: number;
  estimatedMonthlySavingsPaise: number | null;
  action: string | null;
  status: 'active' | 'dismissed';
  generatedAt: Date;
}

const insightSchema = new Schema<AIInsightDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true, maxlength: 240 },
    type: { type: String, required: true },
    severity: { type: String, enum: ['info', 'positive', 'warning'], default: 'info' },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 1200 },
    statements: { type: [new Schema({ kind: String, text: String }, { _id: false })], default: [] },
    evidence: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: Number, default: 0.5 },
    estimatedMonthlySavingsPaise: { type: Number, default: null },
    action: { type: String, default: null, maxlength: 300 },
    status: { type: String, enum: ['active', 'dismissed'], default: 'active' },
    generatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
insightSchema.index({ userId: 1, key: 1 }, { unique: true });
insightSchema.index({ userId: 1, status: 1, generatedAt: -1 });

export const AIInsight = model<AIInsightDoc>('AIInsight', insightSchema);

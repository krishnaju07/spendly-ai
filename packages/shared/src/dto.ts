import type { ClassificationSource, ImportSource, PaymentMethod, TransactionStatus, TransactionType } from './constants';
import type { RangePreset } from './dates';
import type { BudgetLevel, Projection } from './budget';
import type { ImportMapping } from './schemas';
import type { InsightType } from './insights';
import type { RecurringFrequency } from './recurring';

/** Shapes returned by the REST API (JSON). Dates are ISO strings; money is integer paise. */

export interface ApiError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

export interface RangeDto {
  preset: RangePreset;
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
  days: number;
  elapsedDays: number;
  inProgress: boolean;
  label: string;
  timezone: string;
}
export interface BaselineRangeDto extends RangeDto {
  baselineLabel: string;
}

// ── account ────────────────────────────────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  /** E.164, e.g. `+919876543210`. Null for the demo workspace, which has no sign-in. */
  phone: string | null;
  name: string;
  isDemo: boolean;
  demoExpiresAt: string | null;
  createdAt: string;
}

export interface PreferencesDto {
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  currency: 'INR';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  weekStartsOn: 1 | 7;
  incomeTracking: boolean;
  defaultRange: Exclude<RangePreset, 'custom'>;
  ai: { enabled: boolean; shareMerchantNames: boolean; classifyUnknownMerchants: boolean; readReceipts: boolean };
  notifications: { budgetAlerts: boolean; upcomingPayments: boolean; importUpdates: boolean; insights: boolean };
  consents: { emailImport: boolean };
  /** Food and entertainment apps the person allowed Spendly to track; `consentedAt` is null until they have chosen. */
  tracking: { platforms: string[]; consentedAt: string | null };
  onboardingCompleted: boolean;
}

export interface MeDto {
  user: UserDto;
  preferences: PreferencesDto;
  csrfToken: string;
}

/** How sign-in codes reach people on this server. `unavailable` means no SMS provider is configured. */
export interface AuthConfigDto {
  /** `authenticator`: nothing is texted; the server's owners enter the code from their authenticator app. */
  otp: { delivery: 'sms' | 'dev' | 'authenticator' | 'unavailable'; length: number; resendSeconds: number; expiresMinutes: number };
}

export interface OtpRequestResultDto {
  resendInSeconds: number;
  expiresInSeconds: number;
  /** Only when no SMS is sent (development or test mode): the code, so it can be shown on screen. */
  devCode?: string;
  /** The code is in the person's authenticator app: nothing was texted or shown. */
  viaApp?: boolean;
}

/** `needs_name`: the code was right but the number is new — ask for a name and verify again with it. */
export type AuthResultDto = { status: 'needs_name' } | ({ status: 'signed_in'; isNew: boolean } & MeDto);

export interface SessionDto {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

// ── transactions ───────────────────────────────────────────────────────────────────────────────

export interface ClassificationDto {
  source: ClassificationSource;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

import type { OrderDetail } from './order-detail';

/** What a set of transactions adds up to, beyond a total: shown above the list so a month reads at a glance. */
export interface TransactionInsightsDto {
  /** Completed purchases counted. */
  count: number;
  spentPaise: number;
  averagePaise: number;
  biggest: { paise: number; title: string; date: string } | null;
  /** The restaurant or shop ordered from most often (linked accounts only). */
  topPlace: { name: string; orders: number; paise: number } | null;
  topDish: { name: string; times: number } | null;
  /** Dishes by veg mark; null when no order says. */
  diet: { veg: number; nonveg: number; egg: number } | null;
  /** The five places ordered from most, and the five dishes ordered most. */
  places: Array<{ name: string; orders: number; paise: number }>;
  dishes: Array<{ name: string; times: number }>;
  /** Spend per local day, oldest first. */
  daily: Array<{ day: string; paise: number }>;
}

export interface TransactionDto {
  id: string;
  merchantName: string;
  merchantKey: string;
  platform: string | null;
  platformName: string | null;
  amountPaise: number;
  currency: 'INR';
  date: string;
  hasTime: boolean;
  category: string | null;
  categoryName: string | null;
  subcategory: string | null;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  notes: string;
  tags: string[];
  receipt: { filename: string; mimeType: string; size: number } | null;
  importSource: ImportSource;
  /** What the order was (restaurant, area, dishes), when a linked account said; null for everything else. */
  orderDetail: OrderDetail | null;
  externalRef: string | null;
  importJobId: string | null;
  refundOfId: string | null;
  duplicateStatus: 'none' | 'possible' | 'dismissed';
  duplicateOfId: string | null;
  recurringPaymentId: string | null;
  classification: ClassificationDto;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the server learned when a transaction was saved with a corrected classification. */
export interface TransactionSaveResult {
  transaction: TransactionDto;
  /** Similar transactions that a new rule would also change. */
  similarCount?: number;
  ruleId?: string | null;
  /** True when the user may want to be asked "remember this?" */
  suggestRule?: { pattern: string; matchType: 'contains'; similarCount: number } | null;
}

export interface DuplicateGroupDto {
  id: string;
  reasons: string[];
  score: number;
  transactions: TransactionDto[];
}

// ── analytics ──────────────────────────────────────────────────────────────────────────────────

export interface PeriodTotals {
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  incomePaise: number;
  expenseCount: number;
  refundCount: number;
  incomeCount: number;
}

export interface PlatformStatDto {
  slug: string | null;
  name: string;
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  count: number;
  avgPaise: number;
  previousNetPaise: number;
  previousCount: number;
  changePct: number | null;
}

export interface CategoryStatDto {
  slug: string | null;
  name: string;
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  count: number;
  sharePct: number | null;
  previousNetPaise: number;
  changePct: number | null;
}

export interface DashboardSummaryDto {
  range: RangeDto;
  baseline: BaselineRangeDto;
  current: PeriodTotals;
  previous: PeriodTotals;
  changePct: { net: number | null; income: number | null; count: number | null };
  budget: { totalBudgetPaise: number; spentPaise: number; remainingPaise: number; percentUsed: number } | null;
  potentialSavings: { monthlyPaise: number; insightCount: number; confidence: 'low' | 'medium' | 'high' } | null;
  topPlatforms: PlatformStatDto[];
  needsReview: number;
  possibleDuplicates: number;
  hasData: boolean;
  incomeTracking: boolean;
  isDemo: boolean;
}

export interface TrendPointDto {
  key: string;
  label: string;
  grossPaise: number;
  refundsPaise: number;
  netPaise: number;
  incomePaise: number;
  count: number;
}
export interface TrendsDto {
  granularity: 'day' | 'week' | 'month';
  points: TrendPointDto[];
}

export interface CompareDto {
  current: RangeDto;
  baseline: BaselineRangeDto;
  totals: { current: PeriodTotals; previous: PeriodTotals };
  categories: CategoryStatDto[];
  platforms: PlatformStatDto[];
}

export interface PatternsDto {
  weekday: Array<{ weekday: number; label: string; netPaise: number; count: number }>;
  /** Only transactions with a real time of day are included. */
  hourly: Array<{ hour: number; netPaise: number; count: number }>;
  timestampedShare: number | null;
}

export interface MerchantStatDto {
  merchantKey: string;
  merchantName: string;
  platform: string | null;
  netPaise: number;
  count: number;
  lastDate: string;
}

// ── platforms, categories, rules ───────────────────────────────────────────────────────────────

export interface PlatformDto {
  slug: string;
  name: string;
  group: string;
  kind: 'brand' | 'general';
  isCustom: boolean;
  color: string;
  textColor: string;
  monogram: string;
  brandIcon: string | null;
  icon: string | null;
  category: string | null;
  verification: 'verified' | 'probable' | 'custom';
  website: string | null;
  aliases: string[];
  sources: { manual: boolean; csv: boolean; bankStatement: boolean; emailReceipts: boolean; officialApi: 'none' | 'partner_only'; note: string };
  note: string | null;
}

export interface PlatformWithStatsDto extends PlatformDto {
  stats: {
    netPaise: number;
    grossPaise: number;
    refundsPaise: number;
    count: number;
    avgPaise: number;
    previousNetPaise: number;
    changePct: number | null;
    /** Net spend per bucket across the selected range, for the sparkline. */
    sparkline: number[];
  };
}

export interface CategoryDto {
  slug: string;
  name: string;
  kind: 'spending' | 'income' | 'transfer';
  icon: string;
  slot: number | null;
  discretionary: boolean;
  subcategories: string[];
  isCustom: boolean;
}

export interface RuleDto {
  id: string;
  name: string;
  matchType: 'exact' | 'contains' | 'starts_with' | 'regex';
  pattern: string;
  field: 'merchant' | 'description' | 'any';
  platform: string | null;
  category: string | null;
  subcategory: string | null;
  type: TransactionType | null;
  priority: number;
  isActive: boolean;
  source: 'user' | 'learned';
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
}

// ── budgets, recurring, goals ──────────────────────────────────────────────────────────────────

export interface BudgetDto {
  id: string;
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
  window: { fromDate: string; toDate: string; label: string; days: number; elapsedDays: number; inProgress: boolean };
  progress: {
    spentPaise: number;
    remainingPaise: number;
    percentUsed: number;
    level: BudgetLevel;
    crossedThreshold: number | null;
  };
  projection: Projection | null;
  createdAt: string;
}

export interface BudgetHistoryDto {
  id: string;
  points: Array<{ key: string; label: string; spentPaise: number; amountPaise: number; percentUsed: number; level: BudgetLevel }>;
}

export interface BudgetSuggestionDto {
  scope: 'overall' | 'category';
  category: string | null;
  name: string;
  amountPaise: number;
  basis: string;
  basisMonths: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface RecurringDto {
  id: string;
  merchantKey: string;
  displayName: string;
  platform: string | null;
  platformName: string | null;
  category: string | null;
  frequency: RecurringFrequency;
  frequencyLabel: string;
  intervalDays: number;
  amountPaise: number;
  amountMinPaise: number;
  amountMaxPaise: number;
  amountVariable: boolean;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  lastAmountPaise: number;
  nextExpectedDate: string | null;
  daysUntilNext: number | null;
  possiblyInactive: boolean;
  priceChanges: Array<{ date: string; fromPaise: number; toPaise: number }>;
  monthlyCostPaise: number;
  annualCostPaise: number;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  reasons: string[];
  status: 'detected' | 'confirmed' | 'dismissed';
  reminderDaysBefore: number;
}

export interface RecurringSummaryDto {
  items: RecurringDto[];
  totals: {
    confirmedCount: number;
    confirmedMonthlyPaise: number;
    confirmedAnnualPaise: number;
    detectedCount: number;
    detectedMonthlyPaise: number;
    detectedAnnualPaise: number;
  };
  lastDetectedAt: string | null;
}

export interface GoalDto {
  id: string;
  name: string;
  type: string;
  targetAmountPaise: number;
  savedAmountPaise: number;
  targetDate: string;
  notes: string;
  status: 'active' | 'completed';
  progressPct: number;
  remainingPaise: number;
  monthsLeft: number;
  suggestedMonthlyPaise: number;
  /** Average of recorded contributions over the last three months, when there are any. */
  recentMonthlyPaise: number | null;
  onTrack: boolean | null;
  contributions: Array<{ id: string; amountPaise: number; date: string; note: string }>;
  createdAt: string;
}

export interface GoalScenarioDto {
  goalId: string;
  category: string;
  categoryName: string;
  reducePct: number;
  currentMonthlyPaise: number;
  monthlySavingPaise: number;
  plannedMonthlyPaise: number;
  monthsToGoalBaseline: number | null;
  monthsToGoalScenario: number | null;
  monthsSaved: number | null;
  finishBaseline: string | null;
  finishScenario: string | null;
  notes: string[];
}

// ── insights, notifications ────────────────────────────────────────────────────────────────────

export interface InsightDto {
  id: string;
  type: InsightType;
  severity: 'info' | 'positive' | 'warning';
  title: string;
  summary: string;
  statements: Array<{ kind: 'verified' | 'estimate' | 'suggestion'; text: string }>;
  evidence: {
    periodFrom: string;
    periodTo: string;
    baselineFrom?: string;
    baselineTo?: string;
    amountPaise?: number;
    baselinePaise?: number;
    changePct?: number | null;
    txnCount?: number;
    baselineCount?: number;
    calculation: string[];
    transactionIds?: string[];
    scope?: { category?: string; platform?: string };
  };
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  estimatedMonthlySavingsPaise: number | null;
  action: string | null;
  status: 'active' | 'dismissed';
  generatedAt: string;
}

export interface InsightsResponseDto {
  items: InsightDto[];
  period: RangeDto;
  generatedAt: string | null;
  potentialSavingsMonthlyPaise: number;
}

export interface NotificationDto {
  id: string;
  type: 'budget' | 'upcoming_payment' | 'import' | 'insight' | 'system';
  severity: 'info' | 'warning' | 'success';
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ── imports ────────────────────────────────────────────────────────────────────────────────────

export type ImportStatus =
  | 'uploaded'
  | 'needs_mapping'
  | 'queued'
  | 'processing'
  | 'ready_for_review'
  | 'importing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export interface ImportStatsDto {
  totalRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  uncertain: number;
  accepted: number;
  rejected: number;
  pending: number;
  imported: number;
  failedToImport: number;
}

export interface ImportJobDto {
  id: string;
  filename: string;
  fileType: 'csv' | 'xlsx' | 'pdf' | 'eml' | 'image';
  sizeBytes: number;
  kind: 'generic' | 'bank_statement' | 'credit_card_statement' | 'upi_export' | 'receipt' | 'email_receipt';
  source: ImportSource;
  status: ImportStatus;
  progress: { phase: string; processed: number; total: number; percent: number };
  sheets: string[];
  headerRow: number;
  columns: string[];
  sampleRows: string[][];
  detectedFormat: string | null;
  suggestedMapping: ImportMapping | null;
  mapping: ImportMapping | null;
  stats: ImportStatsDto;
  error: string | null;
  notes: string[];
  canRetry: boolean;
  canRollback: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ImportRecordDto {
  id: string;
  rowNumber: number;
  status: 'valid' | 'invalid' | 'duplicate' | 'uncertain';
  decision: 'accepted' | 'rejected' | 'pending';
  raw: Record<string, string>;
  draft: {
    merchantName: string;
    amountPaise: number;
    date: string;
    hasTime: boolean;
    type: TransactionType;
    platform: string | null;
    category: string | null;
    subcategory: string | null;
    paymentMethod: PaymentMethod;
    description: string;
    externalRef: string | null;
  } | null;
  classification: ClassificationDto | null;
  issues: Array<{ code: string; message: string; field?: string }>;
  duplicateOf: { id: string; merchantName: string; date: string; amountPaise: number } | null;
  importedTransactionId: string | null;
}

// ── reports, AI status, integrations ───────────────────────────────────────────────────────────

export interface ReportDto {
  type: string;
  title: string;
  subtitle: string;
  range: RangeDto;
  generatedAt: string;
  timezone: string;
  isDemo: boolean;
  summary: Array<{
    label: string;
    value: string;
    /** A change against the comparison period, written out ("+15%"); `tone` says whether it is good news. */
    delta?: string;
    tone?: 'good' | 'bad' | 'flat';
  }>;
  /** A bar chart for the top of the report: one bar per day (a month) or per month (a year). Money in paise. */
  chart?: { title: string; bars: Array<{ label: string; /** The bar written out in full ('21 Oct'), for calling out the highest. */ full?: string; paise: number }> };
  /** What was ordered, from linked accounts: only when there are orders to describe. */
  food?: {
    places: Array<{ name: string; orders: number; paise: number }>;
    dishes: Array<{ name: string; times: number }>;
    diet: { veg: number; nonveg: number; egg: number } | null;
  };
  sections: Array<{
    title: string;
    note?: string;
    /** Rows hold raw values (money in paise); the viewer, CSV and PDF format them by column. */
    columns: Array<{ key: string; label: string; align?: 'left' | 'right'; format?: 'text' | 'money' | 'percent' | 'number' | 'date' }>;
    rows: Array<Record<string, string | number | null>>;
  }>;
}

export interface AiStatusDto {
  provider: { configured: boolean; name: string | null; model: string | null };
  userEnabled: boolean;
  active: boolean;
  capabilities: { narrate: boolean; parseQuestions: boolean; classifyMerchants: boolean; readReceipts: boolean };
  sends: string[];
  neverSends: string[];
}

export interface IntegrationDto {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'not_configured' | 'unavailable';
  statusLabel: string;
  requires: string[];
  consentRequired: boolean;
  consentGranted: boolean;
}

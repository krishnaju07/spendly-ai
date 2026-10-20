export const TRANSACTION_TYPES = ['expense', 'income', 'refund', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Only "completed" transactions count towards totals. */
export const TRANSACTION_STATUSES = ['completed', 'pending', 'failed', 'reversed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PAYMENT_METHODS = [
  'upi',
  'credit_card',
  'debit_card',
  'net_banking',
  'wallet',
  'cash',
  'bank_transfer',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: 'UPI',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  net_banking: 'Net banking',
  wallet: 'Wallet',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Expense',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  completed: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
  reversed: 'Reversed',
};

export const IMPORT_SOURCES = [
  'manual',
  'csv',
  'xlsx',
  'bank_statement',
  'credit_card_statement',
  'upi_export',
  'pdf_statement',
  'receipt',
  'email',
  'integration',
  'demo',
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  manual: 'Added manually',
  csv: 'CSV file',
  xlsx: 'Excel file',
  bank_statement: 'Bank statement',
  credit_card_statement: 'Credit card statement',
  upi_export: 'UPI export',
  pdf_statement: 'PDF statement',
  receipt: 'Receipt',
  email: 'Email receipt',
  integration: 'Integration',
  demo: 'Demo data',
};

/** How a classification was reached — stored with a confidence and a human-readable reason. */
export const CLASSIFICATION_SOURCES = [
  'user',
  'user_rule',
  'learned_rule',
  'alias',
  'pattern',
  'keyword',
  'ai',
  'default',
] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/** Below this a classification is surfaced for the user to confirm. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const DEFAULT_ALERT_THRESHOLDS = [50, 80, 100] as const;

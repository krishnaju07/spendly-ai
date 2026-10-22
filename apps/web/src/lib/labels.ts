import { IMPORT_SOURCE_LABELS, PAYMENT_METHOD_LABELS, type ClassificationSource, type TransactionDto } from '@spendly/shared';

/** How a classification was reached, in the words shown to people. */
export const SOURCE_LABEL: Record<ClassificationSource, string> = {
  user: 'Set by you',
  user_rule: 'Your rule',
  learned_rule: 'Learned from your edits',
  alias: 'Known name',
  pattern: 'Known pattern',
  keyword: 'Keyword',
  ai: 'AI suggestion',
  default: 'No match',
};

export const MATCH_LABEL = { exact: 'is exactly', contains: 'contains', starts_with: 'starts with', regex: 'matches the pattern' } as const;
export const FIELD_LABEL = { merchant: 'the merchant', description: 'the description', any: 'the merchant or description' } as const;

// ── what a transaction says about itself ───────────────────────────────────────────────────────

const LINKED_SERVICES: Record<string, string> = { 'swiggy:food': 'Swiggy', 'swiggy:im': 'Swiggy Instamart', zepto: 'Zepto', zomato: 'Zomato' };

/** The account a linked order came from, read from its reference ("zomato:8749983458"). */
function linkedFrom(ref: string | null): { service: string; order: string } | null {
  const m = /^(swiggy:food|swiggy:im|zepto|zomato):(.+)$/.exec(ref ?? '');
  return m ? { service: LINKED_SERVICES[m[1] as string] as string, order: m[2] as string } : null;
}

type Source = Pick<TransactionDto, 'importSource' | 'externalRef' | 'description' | 'merchantName' | 'paymentMethod'>;

/** Where a transaction came from, as specific as is known ("Zomato link", not "Integration"). */
export function sourceLabel(t: Source): string {
  const linked = t.importSource === 'integration' ? linkedFrom(t.externalRef) : null;
  return linked ? `${linked.service} link` : IMPORT_SOURCE_LABELS[t.importSource];
}

/** The reference as a person reads it: the order number for a linked order, otherwise as stored. */
export function referenceLabel(t: Pick<TransactionDto, 'externalRef'>): string | null {
  const linked = linkedFrom(t.externalRef);
  return linked ? `Order ${linked.order}` : t.externalRef;
}

/** How it was paid, or null when nobody said (a linked app does not tell Spendly): "Other" would only be noise. */
export function paidWithOf(t: Source): string | null {
  return t.paymentMethod === 'other' && t.importSource !== 'manual' ? null : PAYMENT_METHOD_LABELS[t.paymentMethod];
}

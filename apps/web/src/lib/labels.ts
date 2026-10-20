import type { ClassificationSource } from '@spendly/shared';

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

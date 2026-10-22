import { CATEGORIES, PLATFORMS, type CategoryDto, type PlatformDto, type RuleDto, type TransactionDto } from '@spendly/shared';
import type { CategoryDoc, MerchantRuleDoc, PlatformDoc, TransactionDoc } from '../models/finance';
import type { Lookups } from './lookups';

export function toTransactionDto(t: TransactionDoc, lk: Lookups): TransactionDto {
  return {
    id: t._id.toString(),
    merchantName: t.merchantName,
    merchantKey: t.merchantKey,
    platform: t.platform,
    platformName: lk.platformName(t.platform),
    amountPaise: t.amountPaise,
    currency: 'INR',
    date: t.date.toISOString(),
    hasTime: t.hasTime,
    category: t.category,
    categoryName: lk.categoryName(t.category),
    subcategory: t.subcategory,
    paymentMethod: t.paymentMethod,
    type: t.type,
    status: t.status,
    description: t.description,
    notes: t.notes,
    tags: t.tags,
    receipt: t.receipt ? { filename: t.receipt.filename, mimeType: t.receipt.mimeType, size: t.receipt.size } : null,
    importSource: t.importSource,
    orderDetail: t.orderDetail ?? null,
    externalRef: t.externalRef,
    importJobId: t.importJobId?.toString() ?? null,
    refundOfId: t.refundOfId?.toString() ?? null,
    duplicateStatus: t.duplicateStatus,
    duplicateOfId: t.duplicateOfId?.toString() ?? null,
    recurringPaymentId: t.recurringPaymentId?.toString() ?? null,
    classification: {
      source: t.classification.source,
      confidence: t.classification.confidence,
      reason: t.classification.reason,
      needsReview: t.classification.needsReview,
    },
    isDemo: t.isDemo,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toPlatformDto(p: PlatformDoc): PlatformDto {
  const sources = p.sources as Partial<PlatformDto['sources']>;
  return {
    slug: p.slug,
    name: p.name,
    group: p.group,
    kind: p.kind,
    isCustom: p.userId !== null,
    color: p.color,
    textColor: p.textColor,
    monogram: p.monogram,
    brandIcon: p.brandIcon,
    icon: p.icon,
    category: p.category,
    verification: p.verification,
    website: p.website,
    aliases: p.aliases,
    sources: {
      manual: sources.manual ?? true,
      csv: sources.csv ?? true,
      bankStatement: sources.bankStatement ?? true,
      emailReceipts: sources.emailReceipts ?? false,
      officialApi: sources.officialApi ?? 'none',
      note: sources.note ?? 'Add spending from this platform by importing statements, receipts or entering it manually.',
    },
    note: p.note,
  };
}

export function toCategoryDto(c: CategoryDoc): CategoryDto {
  return {
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    icon: c.icon,
    slot: c.slot,
    discretionary: c.discretionary,
    subcategories: c.subcategories,
    isCustom: c.userId !== null,
  };
}

export function toRuleDto(r: MerchantRuleDoc): RuleDto {
  return {
    id: r._id.toString(),
    name: r.name,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    platform: r.platform,
    category: r.category,
    subcategory: r.subcategory,
    type: r.type,
    priority: r.priority,
    isActive: r.isActive,
    source: r.source,
    hitCount: r.hitCount,
    lastHitAt: r.lastHitAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Documents for the built-in directory, as seeded into the Platform / Category collections. */
export const systemPlatformDocs = () =>
  PLATFORMS.map((p) => ({
    userId: null,
    slug: p.slug,
    name: p.name,
    group: p.group,
    kind: p.kind,
    color: p.color,
    textColor: p.textColor,
    monogram: p.monogram,
    brandIcon: p.brandIcon ?? null,
    icon: p.icon ?? null,
    category: p.category,
    website: p.website ?? null,
    aliases: p.aliases,
    verification: p.verification,
    sources: p.sources,
    note: p.note ?? null,
    isActive: true,
  }));

export const systemCategoryDocs = () =>
  CATEGORIES.map((c) => ({
    userId: null,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    icon: c.icon,
    slot: c.slot,
    discretionary: c.discretionary,
    subcategories: [...c.subcategories],
    isActive: true,
  }));

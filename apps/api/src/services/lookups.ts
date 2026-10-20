import type { Types } from 'mongoose';
import {
  CATEGORIES,
  PLATFORMS,
  type CustomPlatformLike,
  type PlatformGroup,
} from '@spendly/shared';
import { Category, Platform } from '../models/finance';

export interface PlatformInfo {
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
  isCustom: boolean;
}

export interface CategoryInfo {
  slug: string;
  name: string;
  kind: 'spending' | 'income' | 'transfer';
  icon: string;
  slot: number | null;
  discretionary: boolean;
  subcategories: string[];
  isCustom: boolean;
}

export interface Lookups {
  platforms: Map<string, PlatformInfo>;
  categories: Map<string, CategoryInfo>;
  customPlatforms: CustomPlatformLike[];
  platformName(slug: string | null | undefined): string | null;
  categoryName(slug: string | null | undefined): string | null;
}

/** Built-in directory + the user's own platforms and categories, resolved by slug. */
export async function loadLookups(userId: Types.ObjectId): Promise<Lookups> {
  const [customPlatforms, customCategories] = await Promise.all([
    Platform.find({ userId, isActive: true }).lean(),
    Category.find({ userId, isActive: true }).lean(),
  ]);

  const platforms = new Map<string, PlatformInfo>();
  for (const p of PLATFORMS) {
    platforms.set(p.slug, {
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
      isCustom: false,
    });
  }
  for (const p of customPlatforms) {
    platforms.set(p.slug, {
      slug: p.slug,
      name: p.name,
      group: p.group as PlatformGroup,
      kind: p.kind,
      color: p.color,
      textColor: p.textColor,
      monogram: p.monogram,
      brandIcon: null,
      icon: p.icon,
      category: p.category,
      isCustom: true,
    });
  }

  const categories = new Map<string, CategoryInfo>();
  for (const c of CATEGORIES) {
    categories.set(c.slug, { slug: c.slug, name: c.name, kind: c.kind, icon: c.icon, slot: c.slot, discretionary: c.discretionary, subcategories: [...c.subcategories], isCustom: false });
  }
  for (const c of customCategories) {
    categories.set(c.slug, { slug: c.slug, name: c.name, kind: c.kind, icon: c.icon, slot: c.slot, discretionary: c.discretionary, subcategories: c.subcategories, isCustom: true });
  }

  return {
    platforms,
    categories,
    customPlatforms: customPlatforms.map((p) => ({ slug: p.slug, name: p.name, category: p.category, aliases: [p.name, ...p.aliases] })),
    platformName: (slug) => (slug ? (platforms.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ')) : null),
    categoryName: (slug) => (slug ? (categories.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ')) : null),
  };
}

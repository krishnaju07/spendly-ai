import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CATEGORIES, PLATFORMS, type CategoryDto, type PlatformDto } from '@spendly/shared';
import { api } from '@/lib/api';

/** What the UI needs to draw a platform: enough to render a logo and a name without any request. */
export interface PlatformView {
  slug: string;
  name: string;
  group: string;
  kind: 'brand' | 'general';
  color: string;
  textColor: string;
  monogram: string;
  brandIcon: string | null;
  icon: string | null;
  isCustom: boolean;
  category: string | null;
}

const SYSTEM_PLATFORMS: PlatformView[] = PLATFORMS.map((p) => ({
  slug: p.slug,
  name: p.name,
  group: p.group,
  kind: p.kind,
  color: p.color,
  textColor: p.textColor,
  monogram: p.monogram,
  brandIcon: p.brandIcon ?? null,
  icon: p.icon ?? null,
  isCustom: false,
  category: p.category,
}));

const SYSTEM_BY_SLUG = new Map(SYSTEM_PLATFORMS.map((p) => [p.slug, p]));

/** A built-in platform by slug, with no request — for screens that render before anyone is signed in. */
export const systemPlatform = (slug: string): PlatformView | null => SYSTEM_BY_SLUG.get(slug) ?? null;

const SYSTEM_CATEGORIES: CategoryDto[] = CATEGORIES.map((c) => ({
  slug: c.slug,
  name: c.name,
  kind: c.kind,
  icon: c.icon,
  slot: c.slot,
  discretionary: c.discretionary,
  subcategories: [...c.subcategories],
  isCustom: false,
}));

/**
 * The built-in directory is bundled, so names and logos render instantly; the user's custom
 * platforms and categories arrive from the API once and are cached for the session.
 */
export function useCatalog() {
  const dir = useQuery({ queryKey: ['catalog', 'platforms'], queryFn: () => api.get<PlatformDto[]>('/platforms/directory'), staleTime: 10 * 60_000 });
  const cats = useQuery({ queryKey: ['catalog', 'categories'], queryFn: () => api.get<CategoryDto[]>('/categories'), staleTime: 10 * 60_000 });

  return useMemo(() => {
    const platforms = new Map(SYSTEM_PLATFORMS.map((p) => [p.slug, p]));
    for (const p of dir.data ?? []) {
      if (!p.isCustom) continue;
      platforms.set(p.slug, { slug: p.slug, name: p.name, group: p.group, kind: p.kind, color: p.color, textColor: p.textColor, monogram: p.monogram, brandIcon: null, icon: p.icon, isCustom: true, category: p.category });
    }
    const categories = new Map(SYSTEM_CATEGORIES.map((c) => [c.slug, c]));
    for (const c of cats.data ?? []) categories.set(c.slug, c);
    return {
      platform: (slug: string | null | undefined) => (slug ? (platforms.get(slug) ?? null) : null),
      category: (slug: string | null | undefined) => (slug ? (categories.get(slug) ?? null) : null),
      platformName: (slug: string | null | undefined) => (slug ? (platforms.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ')) : 'Other / unassigned'),
      categoryName: (slug: string | null | undefined) => (slug ? (categories.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ')) : 'Uncategorized'),
      platforms: [...platforms.values()],
      categories: [...categories.values()],
      spendingCategories: [...categories.values()].filter((c) => c.kind === 'spending'),
    };
  }, [dir.data, cats.data]);
}

export type Catalog = ReturnType<typeof useCatalog>;

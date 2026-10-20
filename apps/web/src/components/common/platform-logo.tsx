import { Coffee, GraduationCap, House, Fuel, Plane, Popcorn, Stethoscope, Store, Utensils, Zap, CircleDashed, type LucideIcon } from 'lucide-react';
import { BRAND_PATHS } from '@/lib/brand-icons';
import { cn } from '@/lib/utils';
import type { PlatformView } from '@/hooks/use-catalog';

const GENERAL_ICONS: Record<string, LucideIcon> = { Utensils, Coffee, Store, Zap, House, Fuel, Stethoscope, GraduationCap, Plane, Popcorn };

interface Props {
  platform: Pick<PlatformView, 'name' | 'color' | 'textColor' | 'monogram' | 'brandIcon' | 'icon'> | null;
  size?: number;
  className?: string;
}

/**
 * A circular logo tile. Brands with a published glyph show it on their colour; the rest show a
 * monogram, and general buckets (restaurants, rent …) show an icon. Decorative: the name is always
 * rendered next to it, so it is hidden from assistive tech.
 */
export function PlatformLogo({ platform, size = 40, className }: Props) {
  const style = { width: size, height: size } as const;
  if (!platform) {
    return (
      <span aria-hidden style={style} className={cn('grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground', className)}>
        <CircleDashed style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }
  const path = platform.brandIcon ? BRAND_PATHS[platform.brandIcon] : undefined;
  const Icon = platform.icon ? GENERAL_ICONS[platform.icon] : undefined;
  return (
    <span
      aria-hidden
      style={{ ...style, backgroundColor: platform.color, color: platform.textColor }}
      className={cn('grid shrink-0 place-items-center rounded-full ring-1 ring-black/5 select-none dark:ring-white/10', className)}
    >
      {path ? (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.52, height: size * 0.52 }}>
          <path d={path} />
        </svg>
      ) : Icon ? (
        <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
      ) : (
        <span className="leading-none font-semibold tracking-tight" style={{ fontSize: size * (platform.monogram.length > 1 ? 0.34 : 0.44) }}>
          {platform.monogram}
        </span>
      )}
    </span>
  );
}

/** Overlapping logos, like the cashback strip in the reference design. */
export function LogoStack({ items, size = 36, max = 5 }: { items: Props['platform'][]; size?: number; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <span className="flex items-center" aria-hidden>
      {shown.map((p, i) => (
        <PlatformLogo key={i} platform={p} size={size} className="-ml-2.5 border-2 border-card first:ml-0" />
      ))}
    </span>
  );
}

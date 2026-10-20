import {
  ArrowDownToLine,
  ArrowLeftRight,
  Banknote,
  Bike,
  CircleEllipsis,
  Clapperboard,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Plane,
  Receipt,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  ArrowDownToLine,
  ArrowLeftRight,
  Banknote,
  Bike,
  CircleEllipsis,
  Clapperboard,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Plane,
  Receipt,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Tag,
  TrendingUp,
  UtensilsCrossed,
  Zap,
};

export const seriesVar = (slot: number | null | undefined) => (slot ? `var(--series-${slot})` : 'var(--series-other)');

/**
 * Chart colours follow the entity: each category prefers its own palette slot, so "Food delivery"
 * is the same orange everywhere. When two shown categories want the same slot, the lower-ranked
 * one takes the next free slot *for this chart only*; nothing past eight hues is invented.
 */
export function assignSlots<T extends { key: string; slot: number | null }>(items: T[]): Map<string, string> {
  const taken = new Set<number>();
  const out = new Map<string, string>();
  const waiting: T[] = [];
  for (const it of items) {
    if (it.slot && !taken.has(it.slot)) {
      taken.add(it.slot);
      out.set(it.key, seriesVar(it.slot));
    } else waiting.push(it);
  }
  for (const it of waiting) {
    const free = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !taken.has(n));
    if (free) {
      taken.add(free);
      out.set(it.key, seriesVar(free));
    } else out.set(it.key, 'var(--series-other)');
  }
  return out;
}

export function CategoryIcon({ icon, color, size = 36, className }: { icon: string | undefined; color?: string; size?: number; className?: string }) {
  const Icon = (icon && ICONS[icon]) || Tag;
  const c = color ?? 'var(--series-other)';
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full', className)}
      style={{ width: size, height: size, color: c, backgroundColor: `color-mix(in oklab, ${c} 16%, transparent)` }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </span>
  );
}

import {
  CircleHelp,
  Coffee,
  Copy,
  Moon,
  MoonStar,
  Paperclip,
  Repeat,
  ArrowLeftRight,
  Sun,
  Sunrise,
  type LucideIcon,
} from 'lucide-react';
import type { TransactionDto } from '@spendly/shared';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { PlatformLogo } from '@/components/common/platform-logo';
import { useCatalog } from '@/hooks/use-catalog';
import { formatTime } from '@/lib/format';
import { paidWithOf } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { DishChips, detailOfTxn } from './order-detail';
import { TxnAmount } from './txn-row';

/** Which meal an order time falls in: a food order reads better as "Dinner" than as a clock time alone. */
function mealOf(iso: string, tz: string): { label: string; Icon: LucideIcon } {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(
      new Date(iso),
    ),
  );
  if (hour >= 5 && hour < 11) return { label: 'Breakfast', Icon: Sunrise };
  if (hour >= 11 && hour < 15) return { label: 'Lunch', Icon: Sun };
  if (hour >= 15 && hour < 18) return { label: 'Snacks', Icon: Coffee };
  if (hour >= 18 && hour < 22) return { label: 'Dinner', Icon: Moon };
  return { label: 'Late night', Icon: MoonStar };
}

/**
 * One transaction in the ledger. An order from a linked account leads with where it came from, then what was in it
 * (dish chips with their veg mark) and when in the day; anything else leads with the merchant and its category.
 */
export function LedgerRow({
  t,
  tz,
  selected,
  onSelect,
  onOpen,
  showDate = false,
}: {
  t: TransactionDto;
  tz: string;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: (id: string) => void;
  /** The date is not shown by a day heading above (the list is sorted by something else). */
  showDate?: boolean;
}) {
  const cat = useCatalog();
  const platform = cat.platform(t.platform);
  const category = cat.category(t.category);
  const order = detailOfTxn(t);
  const meal = order?.place && t.hasTime ? mealOf(t.date, tz) : null;
  const paid = paidWithOf(t);
  const day = showDate
    ? new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: tz })
    : null;

  // `phone: false` items are left out on a small screen, where the logo already says it
  const meta: Array<{ node: React.ReactNode; phone?: boolean }> = [];
  if (day) meta.push({ node: day });
  if (meal) {
    meta.push({
      node: (
        <span className="inline-flex items-center gap-1">
          <meal.Icon className="size-3.5" aria-hidden />
          {meal.label}
        </span>
      ),
    });
  }
  if (t.hasTime) meta.push({ node: formatTime(t.date, tz) });
  if (!order) meta.push({ node: t.categoryName ?? 'Uncategorized' });
  else if (t.importSource === 'integration' && t.platformName)
    meta.push({ node: `via ${t.platformName}`, phone: false });
  if (paid) meta.push({ node: paid, phone: false });
  if (t.status !== 'completed') meta.push({ node: t.status });

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 rounded-[22px] px-3 py-3 transition-colors sm:gap-4 sm:px-4 sm:py-3.5',
        'hover:bg-accent/60',
        selected && 'bg-accent',
      )}
    >
      <label
        className={cn(
          '-m-2.5 grid shrink-0 cursor-pointer place-items-center p-2.5 transition-opacity',
          !selected &&
            'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${order?.place ?? t.merchantName}`}
          className="size-4 accent-[var(--series-1)]"
        />
      </label>
      <button
        type="button"
        onClick={() => onOpen(t.id)}
        className="relative flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none after:absolute after:inset-0 after:rounded-[22px] focus-visible:after:ring-2 focus-visible:after:ring-ring sm:gap-4"
      >
        <span className="shrink-0 sm:hidden">
          {platform ? (
            <PlatformLogo platform={platform} size={44} />
          ) : (
            <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={44} />
          )}
        </span>
        <span className="hidden shrink-0 sm:block">
          {platform ? (
            <PlatformLogo platform={platform} size={52} />
          ) : (
            <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={52} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold sm:text-base">
              {order?.place ?? t.merchantName}
            </span>
            {t.classification.needsReview && (
              <>
                <CircleHelp
                  className="size-3.5 shrink-0 text-[var(--status-warning)]"
                  aria-hidden
                />
                <span className="sr-only">Needs review</span>
              </>
            )}
            {t.duplicateStatus === 'possible' && (
              <>
                <Copy className="size-3.5 shrink-0 text-[var(--status-serious)]" aria-hidden />
                <span className="sr-only">Possible duplicate</span>
              </>
            )}
            {t.recurringPaymentId && (
              <>
                <Repeat className="size-3.5 shrink-0 opacity-50" aria-hidden />
                <span className="sr-only">Recurring</span>
              </>
            )}
            {t.receipt && (
              <>
                <Paperclip className="size-3.5 shrink-0 opacity-50" aria-hidden />
                <span className="sr-only">Has receipt</span>
              </>
            )}
            {t.type === 'transfer' && (
              <ArrowLeftRight className="size-3.5 shrink-0 opacity-50" aria-hidden />
            )}
          </span>
          {order?.items.length ? (
            <>
              <DishChips items={order.items} max={1} className="mt-1.5 sm:hidden" />
              <DishChips items={order.items} max={3} className="mt-1.5 hidden sm:flex" />
            </>
          ) : null}
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground sm:text-[13px]">
            {meta.map((m, i) => (
              <span
                key={i}
                className={cn(
                  'inline-flex items-center gap-1.5',
                  m.phone === false && 'max-sm:hidden',
                )}
              >
                {i > 0 && (
                  <span aria-hidden className="opacity-50">
                    ·
                  </span>
                )}
                {m.node}
              </span>
            ))}
          </span>
        </span>
        <TxnAmount t={t} size="lg" className="shrink-0 text-[17px] sm:text-[21px]" />
      </button>
    </div>
  );
}

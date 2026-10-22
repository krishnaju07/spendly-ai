import { MapPin } from 'lucide-react';
import {
  legacyDetail,
  type OrderDetail,
  type OrderItem,
  type TransactionDto,
} from '@spendly/shared';
import { cn } from '@/lib/utils';

type WithDetail = Pick<TransactionDto, 'orderDetail' | 'importSource' | 'description'>;

/**
 * What an order was, as data: what the linked account sent, or — for an order saved before that was kept — read back out
 * of its one-line description ("Place · A ×2, B"). Nothing else gets this: anything not from a linked account is someone's own words.
 */
export function detailOfTxn(t: WithDetail): OrderDetail | null {
  if (t.orderDetail && (t.orderDetail.place || t.orderDetail.items.length)) return t.orderDetail;
  return t.importSource === 'integration' ? legacyDetail(t.description) : null;
}

const DIET = {
  veg: { color: 'var(--ok)', label: 'Vegetarian' },
  nonveg: { color: 'var(--bad)', label: 'Non-vegetarian' },
  egg: { color: 'var(--status-warning)', label: 'Contains egg' },
} as const;

/** The square-with-a-dot mark Indian food apps put beside a dish: green for veg, red for non-veg, amber for egg. */
export function DietMark({ diet, className }: { diet: OrderItem['diet']; className?: string }) {
  if (!diet) return null;
  const { color, label } = DIET[diet];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'grid size-3 shrink-0 place-items-center rounded-[3px] border-[1.5px]',
        className,
      )}
      style={{ borderColor: color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

/** A few dishes as small pills on one line, the rest as "+N": reads at a glance where a sentence has to be read. */
export function DishChips({
  items,
  max = 2,
  className,
}: {
  items: OrderItem[];
  max?: number;
  className?: string;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden', className)}>
      {shown.map((item, i) => (
        <span
          key={`${item.name}-${i}`}
          className="inline-flex min-w-0 max-w-[15rem] shrink items-center gap-1.5 rounded-full bg-muted/80 px-2 py-0.5 text-xs text-foreground/90"
        >
          <DietMark diet={item.diet} />
          <span className="truncate">{item.name}</span>
          {item.quantity > 1 && (
            <span className="tnum shrink-0 text-muted-foreground">×{item.quantity}</span>
          )}
        </span>
      ))}
      {rest > 0 && (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground">
          +{rest} more
        </span>
      )}
    </span>
  );
}

/** The same dishes as one plain line, for a phone where a row of pills would only be cut off: "● Mini Tiffin ×2 +8". */
export function DishLine({ items, className }: { items: OrderItem[]; className?: string }) {
  const first = items[0];
  if (!first) return null;
  const rest = items.length - 1;
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-[13px] text-foreground/80', className)}>
      <DietMark diet={first.diet} />
      <span className="truncate">{first.name}</span>
      {first.quantity > 1 && <span className="tnum shrink-0 text-muted-foreground">×{first.quantity}</span>}
      {rest > 0 && <span className="shrink-0 text-muted-foreground">+{rest} more</span>}
    </span>
  );
}

/** The order laid out like a bill: where from, then each dish with its mark and count. */
export function OrderCard({ detail }: { detail: OrderDetail }) {
  const dishes = detail.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <section aria-label="The order" className="rounded-3xl border p-4">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        The order
      </p>
      {detail.place && (
        <p className="mt-1.5 text-[17px] leading-tight font-semibold">{detail.place}</p>
      )}
      {detail.area && (
        <p className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden /> {detail.area}
        </p>
      )}
      {detail.items.length > 0 && (
        <ul className={cn('divide-y', (detail.place || detail.area) && 'mt-3 border-t')}>
          {detail.items.map((item, i) => (
            <li key={`${item.name}-${i}`} className="flex items-center gap-2.5 py-2 text-sm">
              <DietMark diet={item.diet} />
              {!item.diet && <span className="size-3 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 break-words">{item.name}</span>
              {item.quantity > 1 && (
                <span className="tnum shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  ×{item.quantity}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.items.length > 1 && (
        <p className="mt-1 border-t pt-2 text-xs text-muted-foreground">
          {dishes} {dishes === 1 ? 'item' : 'items'}
        </p>
      )}
    </section>
  );
}

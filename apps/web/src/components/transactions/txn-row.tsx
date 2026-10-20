import { CircleHelp, Copy, Paperclip, Repeat, ArrowLeftRight } from 'lucide-react';
import type { TransactionDto } from '@spendly/shared';
import { Money } from '@/components/common/money';
import { PlatformLogo } from '@/components/common/platform-logo';
import { CategoryIcon, seriesVar } from '@/components/common/category-icon';
import { useCatalog } from '@/hooks/use-catalog';
import { formatTime } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@spendly/shared';
import { cn } from '@/lib/utils';

/** Amount as it reads in a ledger: expenses negative, refunds and income green and positive, transfers neutral. */
export function TxnAmount({ t, size = 'md', className }: { t: Pick<TransactionDto, 'type' | 'amountPaise' | 'status'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const tone = t.type === 'income' || t.type === 'refund' ? 'text-ok' : t.type === 'transfer' ? 'text-muted-foreground' : '';
  const paise = t.type === 'expense' ? -t.amountPaise : t.amountPaise;
  return <Money paise={paise} signed={t.type === 'income' || t.type === 'refund'} size={size} className={cn('tnum', tone, t.status !== 'completed' && 'line-through opacity-60', className)} />;
}

/** A transaction as one list row: logo, merchant, context line, amount. */
export function TxnRow({ t, tz, onOpen, selected, onSelect, showDate = false }: {
  t: TransactionDto;
  tz: string;
  onOpen: (id: string) => void;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  showDate?: boolean;
}) {
  const cat = useCatalog();
  const platform = cat.platform(t.platform);
  const category = cat.category(t.category);
  return (
    <div className={cn('group relative flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors', 'hover:bg-accent/70', selected && 'bg-accent')}>
      {onSelect && (
        // the checkbox itself stays small; the label pads its tap target out to a comfortable size
        <label className="-m-2.5 grid shrink-0 cursor-pointer place-items-center p-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`Select ${t.merchantName}`}
            className="size-4 accent-[var(--series-1)]"
          />
        </label>
      )}
      {/* `relative` scopes the after:inset-0 stretched hit area to this button's own box — without it, the
          pseudo-element escapes to the outer (also relative) row and covers the checkbox too. */}
      <button type="button" onClick={() => onOpen(t.id)} className="relative flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
        {platform ? <PlatformLogo platform={platform} size={42} /> : <CategoryIcon icon={category?.icon} color={seriesVar(category?.slot)} size={42} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium">{t.merchantName}</span>
            {t.classification.needsReview && (
              <>
                <CircleHelp className="size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden />
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
            {t.type === 'transfer' && <ArrowLeftRight className="size-3.5 shrink-0 opacity-50" aria-hidden />}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {t.categoryName ?? 'Uncategorized'}
            {showDate && <> · {new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: tz })}</>}
            {t.hasTime && <> · {formatTime(t.date, tz)}</>}
            <> · {PAYMENT_METHOD_LABELS[t.paymentMethod]}</>
            {t.status !== 'completed' && <> · {t.status}</>}
          </span>
        </span>
        <TxnAmount t={t} />
      </button>
    </div>
  );
}

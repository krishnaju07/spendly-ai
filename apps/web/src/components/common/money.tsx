import { splitMoney } from '@spendly/shared';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

const SIZES = {
  hero: { whole: 'type-hero text-[46px] leading-none sm:text-[62px]', dim: 'text-[0.5em]' },
  xl: { whole: 'type-xl text-[32px] leading-none', dim: 'text-[0.58em]' },
  lg: { whole: 'type-lg text-[22px] leading-none', dim: 'text-[0.66em]' },
  md: { whole: 'text-base font-semibold tracking-tight', dim: 'text-[0.85em]' },
  sm: { whole: 'text-sm font-medium', dim: 'text-[0.9em]' },
  inherit: { whole: '', dim: '' },
} as const;

interface MoneyProps {
  paise: number;
  size?: keyof typeof SIZES;
  /** Render the paise part (always when non-zero, or when forced). */
  decimals?: 'auto' | 'always' | 'never';
  /** Show + for positive values (and colour them as income). */
  signed?: boolean;
  className?: string;
  /** Count up to the value. On by default for the large sizes. */
  animate?: boolean;
}

/**
 * Money with the currency sign and paise de-emphasised, so the rupees are what the eye lands on.
 * Large figures use proportional digits; pass `tnum` through className where columns must align.
 */
export function Money({ paise, size = 'md', decimals = 'auto', signed = false, className, animate }: MoneyProps) {
  const counted = useCountUp(paise, animate ?? (size === 'hero' || size === 'xl'));
  const final = splitMoney(paise);
  const parts = splitMoney(counted);
  const s = SIZES[size];
  // the paise show or hide according to the final amount, so the layout does not flicker while counting
  const showFraction = decimals === 'always' || (decimals === 'auto' && final.fraction !== '00');
  const sign = final.sign || (signed && paise > 0 ? '+' : '');
  return (
    <span className={cn('inline-flex items-baseline whitespace-nowrap', s.whole, className)} aria-label={`${sign}${final.symbol}${final.whole}${showFraction ? `.${final.fraction}` : ''}`}>
      {sign && <span>{sign}</span>}
      <span aria-hidden className={cn('mr-[0.06em] opacity-55', s.dim)}>
        {parts.symbol}
      </span>
      <span aria-hidden>{parts.whole}</span>
      {showFraction && (
        <span aria-hidden className={cn('opacity-55', s.dim)}>
          .{parts.fraction}
        </span>
      )}
    </span>
  );
}

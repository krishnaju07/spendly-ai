import { Check } from 'lucide-react';
import { Money } from '@/components/common/money';
import { TYPEFACES, useTypeface } from '@/hooks/use-typeface';
import { cn } from '@/lib/utils';

/**
 * Four pairings, each previewed in its own fonts (the card carries data-typeface, so the same
 * variables the app uses are applied to the sample). Choosing one changes the whole app at once.
 */
export function TypefacePicker() {
  const { typeface, setTypeface } = useTypeface();
  return (
    <div role="radiogroup" aria-label="Typeface" className="grid gap-3 sm:grid-cols-3">
      {TYPEFACES.map((t) => {
        const on = typeface === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-typeface={t.id}
            onClick={() => setTypeface(t.id)}
            className={cn('group relative rounded-3xl border bg-muted/50 p-4 text-left transition-[transform,border-color,background-color,box-shadow] duration-300 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]', on && 'border-foreground/60 bg-accent shadow-card')}
            style={{ fontFamily: 'var(--ui-font)' }}
          >
            <span className={cn('absolute top-3.5 right-3.5 grid size-5 place-items-center rounded-full border transition-colors', on ? 'border-transparent bg-primary text-primary-foreground' : 'border-input text-transparent')}>
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </span>
            <Money paise={10946290} size="xl" animate={false} />
            <p className="type-title mt-3 text-[22px] leading-tight">Spending Analytics</p>
            <p className="mt-2 text-[13px] leading-snug text-muted-foreground">Amazon is your biggest platform this month — ₹40,423, 37% of spending.</p>
            <p className="mt-3 text-sm font-semibold">
              {t.name} <span className="font-normal text-muted-foreground">· {t.fonts}</span>
            </p>
            <p className="text-xs text-muted-foreground">{t.note}</p>
          </button>
        );
      })}
    </div>
  );
}

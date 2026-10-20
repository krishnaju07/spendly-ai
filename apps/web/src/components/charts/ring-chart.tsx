import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface RingSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Pre-formatted amount for the legend and tooltip. */
  display: string;
  href?: string;
  /** Extra line in the legend (e.g. "11 purchases"). */
  meta?: string;
  /** Percentage change vs the baseline, shown as a chip by the caller. */
  trailing?: ReactNode;
}

const SIZE = 240;
const R = 92;
const STROKE = 20;
const C = 2 * Math.PI * R;
const GAP = 25; // gap along the circumference; must exceed the stroke so round caps never touch

/**
 * A segmented ring: thick round-capped arcs with clear gaps, a label in the middle, and a legend
 * beneath. Arcs and legend rows share one hover/focus state, and each links to the filtered
 * transactions it represents. At most six coloured segments — the rest fold into "Other".
 */
export function RingChart({
  slices,
  centerLabel,
  centerValue,
  emptyLabel = 'No spending yet',
  className,
  legend = true,
  onSelect,
}: {
  slices: RingSlice[];
  centerLabel: string;
  centerValue: ReactNode;
  emptyLabel?: string;
  className?: string;
  legend?: boolean;
  onSelect?: (s: RingSlice) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const id = useId();
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((a, s) => a + s.value, 0);
  const activeSlice = positive.find((s) => s.key === active) ?? null;

  const arcs = positive.reduce<Array<{ s: RingSlice; len: number; offset: number }>>((acc, s) => {
    const len = Math.max(1, (s.value / total) * (C - GAP * positive.length));
    const prev = acc[acc.length - 1];
    acc.push({ s, len, offset: prev ? prev.offset + prev.len + GAP : 0 });
    return acc;
  }, []);

  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <div className="relative aspect-square w-full max-w-[17.5rem]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full -rotate-90" role="group" aria-label={`Spending by category: ${positive.map((s) => `${s.label} ${s.display}`).join(', ') || emptyLabel}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          {arcs.map(({ s, len, offset: o }, i) => {
            const isActive = active === s.key;
            const dim = active !== null && !isActive;
            const interactive = Boolean(s.href || onSelect);
            return (
              <circle
                key={s.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={isActive ? STROKE + 5 : STROKE}
                strokeLinecap="round"
                strokeDasharray={`${drawn ? len : 0} ${C - (drawn ? len : 0)}`}
                strokeDashoffset={-o - GAP / 2}
                opacity={!drawn ? 0 : dim ? 0.35 : 1}
                className={cn('outline-none', interactive && 'cursor-pointer')}
                style={{ transitionProperty: 'stroke-dasharray, stroke-dashoffset, stroke-width, opacity', transitionDuration: '1.2s, 1.2s, 0.2s, 0.25s', transitionTimingFunction: 'var(--ease-out)', transitionDelay: `${i * 90}ms, ${i * 90}ms, 0s, 0s` }}
                tabIndex={interactive ? 0 : -1}
                role={interactive ? 'button' : undefined}
                aria-label={`${s.label}: ${s.display}, ${Math.round((s.value / total) * 100)}% of spending`}
                onPointerEnter={() => setActive(s.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(s.key)}
                onBlur={() => setActive(null)}
                onClick={() => onSelect?.(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(s);
                  }
                }}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-14 text-center" aria-live="polite">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <div>
              <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{activeSlice ? activeSlice.label : centerLabel}</p>
              <div className="mt-1.5 flex flex-col items-center">{activeSlice ? <span className="type-lg text-[24px] leading-none">{activeSlice.display}</span> : centerValue}</div>
              {activeSlice && <p className="mt-1 text-xs text-muted-foreground">{Math.round((activeSlice.value / total) * 100)}% of spending</p>}
            </div>
          )}
        </div>
      </div>

      {legend && positive.length > 0 && (
        <ul className="grid w-full gap-2 sm:grid-cols-2" aria-labelledby={id}>
          {positive.map((s) => {
            const inner = (
              <>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{s.label}</span>
                  <span className="tnum block text-xs text-muted-foreground">
                    {s.display} · {Math.round((s.value / total) * 100)}%
                  </span>
                </span>
                {s.trailing}
              </>
            );
            const cls = cn('flex items-center gap-2.5 rounded-2xl bg-muted/70 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', active === s.key && 'bg-accent');
            return (
              <li key={s.key} onPointerEnter={() => setActive(s.key)} onPointerLeave={() => setActive(null)}>
                {s.href ? (
                  <Link to={s.href} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <span id={id} className="sr-only">
        Legend
      </span>
    </div>
  );
}

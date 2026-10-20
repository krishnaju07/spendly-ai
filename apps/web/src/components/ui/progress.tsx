import * as React from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type MeterLevel = 'neutral' | 'ok' | 'warn' | 'bad';

const FILL: Record<MeterLevel, string> = {
  neutral: 'bg-foreground',
  ok: 'bg-series-3',
  warn: 'bg-[var(--status-warning)]',
  bad: 'bg-[var(--status-critical)]',
};
const TRACK: Record<MeterLevel, string> = {
  neutral: 'bg-foreground/10',
  ok: 'bg-series-3/15',
  warn: 'bg-[var(--status-warning)]/20',
  bad: 'bg-[var(--status-critical)]/20',
};

/** A meter: the fill carries severity and the track is a lighter step of the same hue. */
function Progress({
  value,
  level = 'neutral',
  className,
  label,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & { value: number; level?: MeterLevel; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      data-slot="progress"
      className={cn('relative h-2 w-full overflow-hidden rounded-full', TRACK[level], className)}
      {...props}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[1100ms] ease-[var(--ease-out)]', FILL[level])} style={{ width: `${shown}%` }} />
    </div>
  );
}

export { Progress };

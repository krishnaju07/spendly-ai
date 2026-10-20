import { useState, type CSSProperties } from 'react';
import { inrRound } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface HourCell {
  hour: number;
  netPaise: number;
  count: number;
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;

/**
 * Spending by hour of day as a single-hue sequential strip (light = little, dark = a lot). Only
 * transactions with a real time of day are included, which the caller states next to the chart.
 */
export function HourStrip({ cells }: { cells: HourCell[] }) {
  const [hover, setHover] = useState<HourCell | null>(null);
  const max = Math.max(...cells.map((c) => c.netPaise), 1);
  const peak = cells.reduce<HourCell | null>((best, c) => (!best || c.netPaise > best.netPaise ? c : best), null);
  return (
    <div>
      <div className="grid grid-cols-12 gap-1.5 sm:grid-cols-[repeat(24,minmax(0,1fr))]" role="list" aria-label="Spending by hour of day">
        {cells.map((c) => {
          const t = Math.max(0, c.netPaise) / max;
          return (
            <button
              key={c.hour}
              type="button"
              role="listitem"
              aria-label={`${hourLabel(c.hour)}: ${inrRound(c.netPaise)}, ${c.count} purchases`}
              onPointerEnter={() => setHover(c)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(c)}
              onBlur={() => setHover(null)}
              className={cn('reveal h-12 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring', c.netPaise <= 0 && 'bg-muted')}
              style={{ ...(c.netPaise > 0 ? { backgroundColor: `color-mix(in oklab, var(--chart-ramp-7) ${Math.round(12 + t * 88)}%, var(--chart-ramp-1))` } : null), '--i': c.hour * 0.35 } as CSSProperties}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>12 am</span>
        <span>6 am</span>
        <span>12 pm</span>
        <span>6 pm</span>
        <span>11 pm</span>
      </div>
      <p className="mt-3 min-h-5 text-[13px]" aria-live="polite">
        {hover ? (
          <>
            <strong className="tnum">{hourLabel(hover.hour)}</strong> · {inrRound(hover.netPaise)} across {hover.count} purchase{hover.count === 1 ? '' : 's'}
          </>
        ) : (
          <span className="text-muted-foreground">
            {peak && peak.netPaise > 0 ? (
              <>
                Busiest hour: <strong className="tnum text-foreground">{hourLabel(peak.hour)}</strong> · {inrRound(peak.netPaise)} across {peak.count} purchase{peak.count === 1 ? '' : 's'}.{' '}
              </>
            ) : null}
            Hover or focus an hour for details.
          </span>
        )}
      </p>
    </div>
  );
}

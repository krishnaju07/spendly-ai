import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactINR } from '@spendly/shared';
import { inrRound } from '@/lib/format';
import { TipBox, axisProps, gridProps } from './chart-frame';

type Tip = { active?: boolean; payload?: ReadonlyArray<{ payload: Record<string, unknown> }> };

export interface MomPoint {
  day: number;
  currentPaise: number | null;
  previousPaise: number | null;
}

/** Cumulative spending, this month against last: two 2px lines, one crosshair, one tooltip for both. */
export function MomLines({ data, currentLabel, previousLabel }: { data: MomPoint[]; currentLabel: string; previousLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="mom-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...axisProps} axisLine={false} width={46} tickFormatter={(v: number) => formatCompactINR(v)} tickCount={4} />
        <Tooltip
          cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
          content={(raw) => {
            const p = raw as unknown as Tip;
            const row = p.payload?.[0]?.payload as unknown as MomPoint | undefined;
            if (!p.active || !row) return null;
            return (
              <TipBox
                title={`Day ${row.day}`}
                rows={[
                  ...(row.currentPaise !== null ? [{ color: 'var(--series-1)', label: currentLabel, value: inrRound(row.currentPaise) }] : []),
                  ...(row.previousPaise !== null ? [{ color: 'var(--chart-muted)', label: previousLabel, value: inrRound(row.previousPaise) }] : []),
                ]}
              />
            );
          }}
        />
        <Area type="monotone" dataKey="currentPaise" stroke="none" fill="url(#mom-fill)" activeDot={false} connectNulls={false} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
        <Line type="monotone" dataKey="previousPaise" stroke="var(--chart-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: 'var(--chart-muted)' }} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
        <Line type="monotone" dataKey="currentPaise" stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2, fill: 'var(--series-1)' }} connectNulls={false} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** A tiny trend line. Decorative: the figures it summarises are always shown as text beside it. */
export function Sparkline({ values, width = 84, height = 28, color = 'var(--series-1)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 8) + 4, height - 4 - ((v - min) / span) * (height - 8)] as const);
  const last = pts[pts.length - 1];
  if (!last || values.every((v) => v === 0)) return <svg width={width} height={height} aria-hidden><line x1="4" x2={width - 4} y1={height - 4} y2={height - 4} stroke="var(--chart-grid)" strokeWidth="2" strokeLinecap="round" /></svg>;
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline className="spark-line" pathLength={1} points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeOpacity={0.6} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="spark-dot" cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

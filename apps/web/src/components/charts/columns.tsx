import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactINR } from '@spendly/shared';
import { inrRound } from '@/lib/format';
import { TipBox, axisProps, gridProps } from './chart-frame';

type Tip = { active?: boolean; payload?: ReadonlyArray<{ payload: Record<string, unknown> }> };

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Overrides the series colour for this column (e.g. over-budget months). */
  color?: string;
  dim?: boolean;
  extra?: Array<{ label: string; value: string }>;
}

/** A bar whose colour, emphasis and 4px rounded data-end come from the row itself. */
function ColumnShape(props: Record<string, unknown>) {
  const p = props as { x: number; y: number; width: number; height: number; payload: { color?: string; dim?: boolean }; fill: string };
  const base = p.payload.color ?? p.fill;
  const fill = p.payload.dim ? `color-mix(in oklab, ${base} 38%, transparent)` : base;
  return <Rectangle {...(props as object)} fill={fill} radius={[4, 4, 0, 0]} />;
}

/**
 * Thin columns (≤ 24px) from one baseline, a 4px rounded top, hairline solid grid, compact ₹ axis.
 * The mark itself is the hover target; click selects it (used to drill into transactions).
 */
export function ColumnChart({
  data,
  color = 'var(--series-1)',
  seriesLabel = 'Net spend',
  onSelect,
  refLine,
  tickEvery,
  formatValue = inrRound,
}: {
  data: Column[];
  color?: string;
  seriesLabel?: string;
  onSelect?: (c: Column) => void;
  refLine?: { value: number; label: string };
  tickEvery?: number;
  formatValue?: (paise: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: refLine ? 8 : 4, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval={tickEvery ? tickEvery - 1 : 'preserveStartEnd'} minTickGap={28} />
        <YAxis {...axisProps} axisLine={false} width={46} tickFormatter={(v: number) => formatCompactINR(v)} tickCount={4} />
        <Tooltip
          cursor={{ fill: 'var(--accent)', opacity: 0.45, radius: 8 }}
          content={(raw) => {
            const p = raw as unknown as Tip;
            const row = p.payload?.[0]?.payload as unknown as Column | undefined;
            if (!p.active || !row) return null;
            return <TipBox title={row.label} rows={[{ color: row.color ?? color, label: seriesLabel, value: formatValue(row.value) }, ...(row.extra ?? [])]} />;
          }}
        />
        {refLine && (
          <ReferenceLine y={refLine.value} stroke="var(--foreground)" strokeWidth={1.5} strokeOpacity={0.55} label={{ value: refLine.label, position: 'insideTopRight', fill: 'var(--chart-muted)', fontSize: 11 }} />
        )}
        <Bar
          dataKey="value"
          fill={color}
          maxBarSize={24}
          shape={<ColumnShape />}
          isAnimationActive animationDuration={900} animationEasing="ease-out"
          onClick={(d) => onSelect?.(d as unknown as Column)}
          cursor={onSelect ? 'pointer' : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface PairRow {
  key: string;
  label: string;
  current: number;
  previous: number;
}

/** Two periods side by side per category — horizontal bars, current in the lead colour, previous de-emphasised. */
export function PairBars({ data, currentLabel, previousLabel, onSelect }: { data: PairRow[]; currentLabel: string; previousLabel: string; onSelect?: (r: PairRow) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" {...axisProps} axisLine={false} tickFormatter={(v: number) => formatCompactINR(v)} tickCount={4} />
        <YAxis type="category" dataKey="label" {...axisProps} axisLine={false} width={118} tick={{ fill: 'var(--foreground)', fontSize: 12 }} />
        <Tooltip
          cursor={{ fill: 'var(--accent)', opacity: 0.45 }}
          content={(raw) => {
            const p = raw as unknown as Tip;
            const row = p.payload?.[0]?.payload as unknown as PairRow | undefined;
            if (!p.active || !row) return null;
            return (
              <TipBox
                title={row.label}
                rows={[
                  { color: 'var(--series-1)', label: currentLabel, value: inrRound(row.current) },
                  { color: 'var(--chart-muted)', label: previousLabel, value: inrRound(row.previous) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="current" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive animationDuration={900} animationEasing="ease-out" onClick={(d) => onSelect?.(d as unknown as PairRow)} cursor={onSelect ? 'pointer' : undefined} />
        <Bar dataKey="previous" fill="var(--chart-muted)" fillOpacity={0.55} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive animationBegin={160} animationDuration={900} animationEasing="ease-out" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface StackPoint {
  key: string;
  label: string;
  values: Record<string, number>;
}

/** Spending over time split by category/platform. Segments are separated by a 2px gap in the surface colour. */
export function StackedColumns({ points, series, colors }: { points: StackPoint[]; series: Array<{ key: string; name: string }>; colors: Map<string, string> }) {
  const rows = points.map((p) => ({ key: p.key, label: p.label, ...Object.fromEntries(series.map((s) => [s.key, Math.max(0, p.values[s.key] ?? 0)])) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...axisProps} axisLine={false} width={46} tickFormatter={(v: number) => formatCompactINR(v)} tickCount={4} />
        <Tooltip
          cursor={{ fill: 'var(--accent)', opacity: 0.45, radius: 8 }}
          content={(raw) => {
            const p = raw as unknown as Tip;
            const row = p.payload?.[0]?.payload as Record<string, number | string> | undefined;
            if (!p.active || !row) return null;
            const items = series
              .map((s) => ({ color: colors.get(s.key) ?? 'var(--series-other)', label: s.name, value: Number(row[s.key] ?? 0) }))
              .filter((r) => r.value > 0)
              .sort((a, b) => b.value - a.value);
            return <TipBox title={String(row.label)} rows={items.map((i) => ({ color: i.color, label: i.label, value: inrRound(i.value) }))} />;
          }}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="stack"
            fill={colors.get(s.key) ?? 'var(--series-other)'}
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={24}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive animationDuration={900} animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

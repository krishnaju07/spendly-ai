import { useId, useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Every chart lives in a frame that gives it a title, an accessible name, a "view as table" twin
 * (the WCAG-clean equivalent), and the standard loading behaviour: while data refetches the
 * previous render stays visible, dimmed, so nothing jumps.
 */
export function ChartCard({
  title,
  description,
  table,
  action,
  isPending,
  isFetching,
  error,
  onRetry,
  empty,
  className,
  children,
  height = 240,
}: {
  title: string;
  description?: ReactNode;
  table?: ChartTable;
  action?: ReactNode;
  isPending?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: ReactNode;
  className?: string;
  children: ReactNode;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader className="flex-wrap">
        <div className="min-w-0 flex-1 basis-48">
          <CardTitle id={`${id}-t`}>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        <CardAction className="max-w-full shrink flex-wrap justify-end">
          {action}
          {table && !empty && (
            <Button variant="ghost" size="icon-sm" aria-pressed={asTable} aria-label={asTable ? 'Show chart' : 'View as table'} onClick={() => setAsTable((v) => !v)}>
              <Table2 />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      {isPending ? (
        <Skeleton className="w-full rounded-2xl" style={{ height }} />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : empty ? (
        <div className="grid place-items-center" style={{ minHeight: height }}>{empty}</div>
      ) : (
        <div className={cn('transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching || undefined}>
          {asTable && table ? (
            <DataTable table={table} labelledBy={`${id}-t`} />
          ) : (
            <>
              <div role="img" aria-labelledby={`${id}-t`} style={{ height }} className="w-full">
                {children}
              </div>
              {table && (
                <div className="sr-only">
                  <DataTable table={table} labelledBy={`${id}-t`} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function DataTable({ table, labelledBy }: { table: ChartTable; labelledBy: string }) {
  return (
    <div className="max-h-72 overflow-auto rounded-2xl border">
      <table aria-labelledby={labelledBy} className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((cell, j) => (
                <td key={j} className={cn('px-3 py-2', j > 0 ? 'tnum text-right' : 'font-medium')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tooltip body: the value leads, the label follows; rows are keyed by a short line of the series colour. */
export function TipBox({ title, rows }: { title?: string; rows: Array<{ color?: string; label: string; value: string }> }) {
  return (
    <div className="min-w-[10rem] rounded-2xl border bg-popover px-3.5 py-2.5 text-popover-foreground shadow-xl">
      {title && <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>}
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2.5">
            {r.color && <span aria-hidden className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />}
            <span className="tnum text-sm font-semibold">{r.value}</span>
            <span className="text-xs text-muted-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items, className }: { items: Array<{ key: string; label: string; color: string }>; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)}>
      {items.map((i) => (
        <li key={i.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Shared axis styling: hairline, recessive, in muted ink — never the series colour. */
export const axisProps = {
  tick: { fill: 'var(--chart-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--chart-axis)' },
} as const;
export const gridProps = { stroke: 'var(--chart-grid)', vertical: false } as const;

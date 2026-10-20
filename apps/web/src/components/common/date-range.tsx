import { useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { DateTime } from 'luxon';
import type { RangePreset } from '@spendly/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFilters } from '@/lib/filters';
import { cn } from '@/lib/utils';

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This year',
  last_year: 'Last year',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  last_12_months: 'Last 12 months',
  custom: 'Custom range',
};

const MAIN: RangePreset[] = ['this_month', 'last_month', 'last_7_days', 'last_30_days', 'last_90_days', 'this_year'];
const MORE: RangePreset[] = ['today', 'yesterday', 'this_week', 'last_week', 'this_quarter', 'last_quarter', 'last_12_months', 'this_fy', 'last_fy', 'last_year'];

export function rangeLabel(range: { preset: RangePreset | null; from: string | null; to: string | null }): string {
  if (range.from && range.to) {
    const a = DateTime.fromISO(range.from);
    const b = DateTime.fromISO(range.to);
    return a.hasSame(b, 'year') ? `${a.toFormat('d LLL')} – ${b.toFormat('d LLL')}` : `${a.toFormat('d LLL yy')} – ${b.toFormat('d LLL yy')}`;
  }
  return RANGE_LABELS[range.preset ?? 'this_month'];
}

/**
 * Date range as a list of presets (nobody fights a calendar for "last 30 days"), with the custom
 * range tucked below a hairline. The selection lives in the URL, so every page and link agrees.
 */
export function DateRangePicker({ className }: { className?: string }) {
  const { range, setRange } = useFilters();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from ?? '');
  const [to, setTo] = useState(range.to ?? '');
  const customActive = Boolean(range.from && range.to);

  const choose = (preset: RangePreset) => {
    setRange({ preset });
    setOpen(false);
  };
  const row = (preset: RangePreset) => {
    const active = !customActive && range.preset === preset;
    return (
      <button
        key={preset}
        type="button"
        onClick={() => choose(preset)}
        className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent', active && 'font-semibold')}
      >
        {RANGE_LABELS[preset]}
        {active && <Check className="size-4" strokeWidth={2.5} aria-label="Selected" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className={cn('h-10 gap-2 bg-card text-card-foreground shadow-card hover:bg-card/80', className)} aria-label={`Date range: ${rangeLabel(range)}`}>
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="max-w-[9.5rem] truncate">{rangeLabel(range)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div role="group" aria-label="Presets">
          {MAIN.map(row)}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:bg-accent">
              More ranges <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-1">{MORE.map(row)}</div>
          </details>
        </div>
        <div className="my-2 h-px bg-border" />
        <form
          className="space-y-3 px-1 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && to >= from) {
              setRange({ from, to });
              setOpen(false);
            }
          }}
        >
          <p className="px-2 text-xs font-medium text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="range-from" className="px-1 text-xs">
                From
              </Label>
              <Input id="range-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-10 px-2 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="range-to" className="px-1 text-xs">
                To
              </Label>
              <Input id="range-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-10 px-2 text-sm" />
            </div>
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={!from || !to || to < from}>
            Apply range
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

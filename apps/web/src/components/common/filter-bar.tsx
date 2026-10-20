import { useMemo, useState } from 'react';
import { Check, ChevronDown, ListFilter, X } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from '@spendly/shared';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCatalog } from '@/hooks/use-catalog';
import { useFilters, type Filters } from '@/lib/filters';
import { cn } from '@/lib/utils';

interface Opt {
  value: string;
  label: string;
  group?: string;
}

function MultiSelect({ label, options, selected, onChange, searchable = true }: { label: string; options: Opt[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, Opt[]>();
    for (const o of options) map.set(o.group ?? '', [...(map.get(o.group ?? '') ?? []), o]);
    return [...map.entries()];
  }, [options]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const names = selected.map((s) => options.find((o) => o.value === s)?.label ?? s);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-10 gap-1.5 bg-card/60', selected.length > 0 && 'border-foreground/40 bg-card')}>
          {label}
          {selected.length > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 text-primary-foreground">{selected.length === 1 ? names[0] : selected.length}</span>}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          {searchable && <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />}
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing found.</CommandEmpty>
            {groups.map(([group, opts]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {opts.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)}>
                    <span className="flex-1">{o.label}</span>
                    {selected.includes(o.value) && <Check className="size-4" strokeWidth={2.5} aria-label="Selected" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t p-1.5">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

type Dim = keyof Filters;

/** One row above the data it scopes: category, platform, payment method, type. */
export function FilterBar({ dims = ['category', 'platform', 'paymentMethod', 'type'], className }: { dims?: Dim[]; className?: string }) {
  const { filters, setFilter, clearFilters, activeCount } = useFilters();
  const cat = useCatalog();

  const categoryOptions: Opt[] = [...cat.categories.map((c) => ({ value: c.slug, label: c.name })), { value: 'none', label: 'Uncategorized' }];
  const platformOptions: Opt[] = [
    ...cat.platforms.map((p) => ({ value: p.slug, label: p.name, group: p.group })),
    { value: 'none', label: 'Other / unassigned', group: 'Other' },
  ];
  const paymentOptions: Opt[] = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));
  const typeOptions: Opt[] = TRANSACTION_TYPES.map((t) => ({ value: t, label: TRANSACTION_TYPE_LABELS[t] }));

  return (
    <div className={cn('scrollbar-none relative -mx-3 flex snap-x items-center gap-2 overflow-x-auto scroll-px-3 px-3 py-1 *:shrink-0 *:snap-start md:mx-0 md:flex-wrap md:overflow-visible md:p-0', className)} role="group" aria-label="Filters">
      <span className="mr-1 hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
        <ListFilter className="size-3.5" /> Filter
      </span>
      {dims.includes('category') && <MultiSelect label="Category" options={categoryOptions} selected={filters.category} onChange={(v) => setFilter('category', v)} />}
      {dims.includes('platform') && <MultiSelect label="Platform" options={platformOptions} selected={filters.platform} onChange={(v) => setFilter('platform', v)} />}
      {dims.includes('paymentMethod') && <MultiSelect label="Payment" options={paymentOptions} selected={filters.paymentMethod} onChange={(v) => setFilter('paymentMethod', v)} searchable={false} />}
      {dims.includes('type') && <MultiSelect label="Type" options={typeOptions} selected={filters.type} onChange={(v) => setFilter('type', v)} searchable={false} />}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 text-muted-foreground">
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

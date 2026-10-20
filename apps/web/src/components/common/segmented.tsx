import { useActivePill } from '@/hooks/use-active-pill';
import { cn } from '@/lib/utils';

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A compact radio group styled as a row of pills — the WEEK / MONTH / YEAR switch from the reference. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
  fill = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
  size?: 'sm' | 'md';
  /** Stretch to the container, with equal-width options. */
  fill?: boolean;
}) {
  const ref = useActivePill<HTMLDivElement>();
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('pill-host items-center rounded-full bg-muted p-1', fill ? 'flex w-full' : 'inline-flex', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-[13px]',
              fill && 'flex-1 text-center',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

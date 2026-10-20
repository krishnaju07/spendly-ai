import { cn } from '@/lib/utils';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** An amount whose digits roll like a mechanical counter whenever the value changes. */
export function Odometer({ value, className }: { value: string; className?: string }) {
  const dot = value.indexOf('.');
  return (
    <span className={cn('odo', className)} role="img" aria-label={value}>
      {[...value].map((ch, i) => {
        const dim = dot >= 0 && i >= dot;
        if (!/\d/.test(ch)) {
          return (
            <span key={i} aria-hidden className={cn(ch === '₹' ? 'odo-sym' : undefined, dim && 'odo-dim')}>
              {ch}
            </span>
          );
        }
        return (
          <span key={i} aria-hidden className={cn('odo-col', dim && 'odo-dim')}>
            <span className="odo-strip" style={{ transform: `translateY(${-Number(ch)}em)`, transitionDelay: `${i * 45}ms` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

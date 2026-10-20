import { useCountUp } from '@/hooks/use-count-up';

/** A whole number that counts up to its value; screen readers get the final figure straight away. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value, true, 900);
  return (
    <span className={className}>
      <span aria-hidden>{shown.toLocaleString('en-IN')}</span>
      <span className="sr-only">{value.toLocaleString('en-IN')}</span>
    </span>
  );
}

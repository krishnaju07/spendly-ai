import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FloatFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon: LucideIcon;
  error?: string;
  trailing?: ReactNode;
  /** A fixed lead-in such as the country code. The label stays raised so the two never overlap. */
  prefix?: string;
}

/** An input whose label floats up when focused or filled, with an icon, a focus bar and an inline error. */
export const FloatField = forwardRef<HTMLInputElement, FloatFieldProps>(function FloatField({ id, label, icon: Icon, error, trailing, prefix, className, ...rest }, ref) {
  return (
    <div className={cn('ff', prefix && 'ff-has-prefix', error && 'ff-error', className)}>
      <input ref={ref} id={id} placeholder=" " aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="ff-input" {...rest} />
      <Icon className="ff-icon" aria-hidden />
      {prefix && (
        <span className="ff-prefix" aria-hidden>
          {prefix}
        </span>
      )}
      <label htmlFor={id} className="ff-label">
        {label}
      </label>
      {trailing && <div className="ff-trailing">{trailing}</div>}
      <span className="ff-bar" aria-hidden />
      {error && (
        <p id={`${id}-error`} role="alert" className="ff-msg">
          {error}
        </p>
      )}
    </div>
  );
});

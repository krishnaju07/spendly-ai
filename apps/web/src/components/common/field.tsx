import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** A labelled form control with an optional hint and an inline, announced error. */
export function Field({ label, error, hint, htmlFor, children }: { label: string; error?: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="px-1 text-[13px]">
        {label}
      </Label>
      {children}
      {hint && !error && <p className="px-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="px-1 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

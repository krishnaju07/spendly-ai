import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/logo';

export const SERVICE_NAMES: Record<string, string> = { swiggy: 'Swiggy', zepto: 'Zepto', zomato: 'Zomato' };

/** The small card both halves of linking show: the window is only on screen for a moment, so it says what is going on. */
export function LinkCard({ title, body, busy, children }: { title: string; body: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-sm rounded-[28px] border bg-card p-7 text-center shadow-card" role="status" aria-live="polite">
        <div className="mb-5 flex justify-center"><Logo /></div>
        {busy && <span className="mx-auto mb-4 block size-6 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
        <h1 className="type-title text-xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {children}
      </div>
    </div>
  );
}

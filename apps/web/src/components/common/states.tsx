import { CloudOff, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, actions, className }: { title: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="type-title text-[27px] leading-[1.08] text-balance sm:text-[33px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>
      <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{children}</h2>
      {action}
    </div>
  );
}

interface EmptyProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { label: string; to?: string; onClick?: () => void };
  secondary?: { label: string; to?: string; onClick?: () => void };
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, secondary, className, compact }: EmptyProps) {
  const btn = (a: NonNullable<EmptyProps['action']>, variant: 'default' | 'secondary') =>
    a.to ? (
      <Button asChild variant={variant}>
        <Link to={a.to}>{a.label}</Link>
      </Button>
    ) : (
      <Button variant={variant} onClick={a.onClick}>
        {a.label}
      </Button>
    );
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      {Icon && (
        <span className="mb-1 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
      )}
      <h3 className="type-headline text-[22px] leading-tight">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {(action || secondary) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {action && btn(action, 'default')}
          {secondary && btn(secondary, 'secondary')}
        </div>
      )}
    </div>
  );
}

/** A failed load that says what happened and offers the way out (retry, or check the connection). */
export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const e = error instanceof ApiRequestError ? error : null;
  const offline = e?.isNetwork;
  const Icon = offline ? CloudOff : TriangleAlert;
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      <span className="grid size-12 place-items-center rounded-full bg-bad-soft text-bad">
        <Icon className="size-5" />
      </span>
      <h3 className="text-base font-semibold">{offline ? 'You are offline' : 'We could not load this'}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {offline ? 'Check your connection — your data is safe on the server and will load as soon as you are back.' : (e?.message ?? 'Something went wrong. Please try again.')}
      </p>
      {e?.requestId && <p className="text-xs text-muted-foreground/70">Reference {e.requestId.slice(0, 8)}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function CardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-2xl" />
      ))}
    </div>
  );
}

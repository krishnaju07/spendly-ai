import { ArrowDownRight, ArrowUpRight, BadgeCheck, Calculator, CircleAlert, CircleCheck, Lightbulb, Minus, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { pct } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A change against a baseline. `goodWhen` says which direction is good (spending: down; income:
 * up), and the chip always carries an arrow and a number so colour is never the only signal.
 */
export function Delta({ value, goodWhen = 'down', className, label }: { value: number | null | undefined; goodWhen?: 'up' | 'down'; className?: string; label?: string }) {
  if (value === null || value === undefined) return <Badge variant="default" className={className}>New</Badge>;
  if (Math.abs(value) < 0.5) {
    return (
      <Badge variant="default" className={className}>
        <Minus aria-hidden />
        0%{label ? ` ${label}` : ''}
      </Badge>
    );
  }
  const up = value > 0;
  const good = goodWhen === 'up' ? up : !up;
  return (
    <Badge variant={good ? 'ok' : 'warn'} className={cn('pop-in', className)}>
      {up ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
      <span className="sr-only">{up ? 'Up' : 'Down'} </span>
      {pct(value)}
      {label ? ` ${label}` : ''}
    </Badge>
  );
}

/** One mapping for every classification confidence in the app: 85%+ is high, 60%+ medium, anything lower is low. */
export const confidenceLevel = (c: number): 'high' | 'medium' | 'low' => (c >= 0.85 ? 'high' : c >= 0.6 ? 'medium' : 'low');

const CONF = {
  high: { icon: ShieldCheck, variant: 'ok', label: 'High confidence' },
  medium: { icon: ShieldQuestion, variant: 'warn', label: 'Medium confidence' },
  low: { icon: ShieldAlert, variant: 'bad', label: 'Low confidence' },
} as const;

export function ConfidenceBadge({ level, score, className }: { level: 'high' | 'medium' | 'low'; score?: number; className?: string }) {
  const c = CONF[level];
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className={className}>
      <Icon aria-hidden />
      {c.label}
      {score !== undefined ? ` · ${Math.round(score * 100)}%` : ''}
    </Badge>
  );
}

const STATEMENT = {
  verified: { icon: BadgeCheck, label: 'Verified', variant: 'ok' },
  estimate: { icon: Calculator, label: 'Estimate', variant: 'warn' },
  suggestion: { icon: Lightbulb, label: 'Suggestion', variant: 'default' },
} as const;

/** Distinguishes what the data proves from projections and from advice. */
export function StatementBadge({ kind, className }: { kind: keyof typeof STATEMENT; className?: string }) {
  const s = STATEMENT[kind];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={className}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

export function LevelBadge({ level, children }: { level: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const Icon = level === 'ok' ? CircleCheck : level === 'warn' ? TriangleAlert : CircleAlert;
  return (
    <Badge variant={level}>
      <Icon aria-hidden />
      {children}
    </Badge>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />;
}

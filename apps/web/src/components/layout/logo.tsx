import { cn } from '@/lib/utils';

/**
 * The ring mark (also the app icon) with the wordmark. The arc draws itself when the mark first
 * appears and spins once when hovered; the wordmark is set in the display face.
 */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('group/logo inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 512 512" className="size-9 shrink-0" aria-hidden>
        <rect width="512" height="512" rx="116" fill="#0A0B0D" />
        <circle cx="256" cy="256" r="112" fill="none" stroke="#1B2A2D" strokeWidth="46" />
        <g className="origin-center [transform-box:view-box] transition-transform duration-[900ms] ease-[var(--spring-soft)] group-hover/logo:rotate-[360deg]">
          <path d="M256 144 A112 112 0 1 1 144 256" fill="none" stroke="#B8F8FD" strokeWidth="46" strokeLinecap="round" pathLength={1} className="logo-arc" />
        </g>
        <circle cx="256" cy="256" r="24" fill="#fff" className="logo-dot" />
      </svg>
      {!compact && <span className="type-mark text-[18px]">Spendly</span>}
      {compact && <span className="sr-only">Spendly</span>}
    </span>
  );
}

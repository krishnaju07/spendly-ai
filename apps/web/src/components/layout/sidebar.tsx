import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { maskPhone } from '@spendly/shared';
import { NavLink } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/hooks/use-auth';
import { useActivePill } from '@/hooks/use-active-pill';
import { NAV } from '@/lib/nav';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

const KEY = 'spendly-sidebar';

export function Sidebar() {
  const { user } = useSession();
  const navRef = useActivePill<HTMLElement>();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return saved === 'collapsed';
    } catch {
      /* storage unavailable */
    }
    return innerWidth < 1280;
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? 'expanded' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <aside
      aria-label="Primary"
      className={cn(
        'sticky top-[calc(var(--banner-h,0px)+0.75rem)] hidden h-[calc(100dvh-var(--banner-h,0px)-1.5rem)] shrink-0 flex-col rounded-[28px] border bg-card p-3 shadow-card transition-[width] duration-300 md:flex',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}
    >
      <div className={cn('flex items-center px-1.5 pt-1.5 pb-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Logo compact={collapsed} />
      </div>

      <nav ref={navRef} className="pill-host scrollbar-none flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV.map((item) => {
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex h-11 items-center gap-3 rounded-full px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="size-[18px] shrink-0 transition-transform duration-300 ease-[var(--spring-bouncy)] group-hover:scale-110" strokeWidth={1.9} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold" aria-hidden>
          {initials(user.name)}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.isDemo ? 'Demo workspace' : user.phone ? maskPhone(user.phone) : ''}</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn('grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', collapsed && 'hidden')}
        >
          <PanelLeftClose className="size-[18px]" />
        </button>
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand sidebar"
          className="mx-auto mt-2 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PanelLeftOpen className="size-[18px]" />
        </button>
      )}
    </aside>
  );
}

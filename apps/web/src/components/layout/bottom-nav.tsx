import { useState } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useActivePill } from '@/hooks/use-active-pill';
import { BOTTOM_TABS, NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * The mobile navigation: a floating pill of primary tabs, a "More" sheet for everything else, and
 * a separate round action button — the layout from the reference designs.
 */
export function BottomNav({ onAdd }: { onAdd: () => void }) {
  const [more, setMore] = useState(false);
  const pillRef = useActivePill<HTMLDivElement>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tabs = NAV.filter((n) => (BOTTOM_TABS as readonly string[]).includes(n.to));
  const rest = NAV.filter((n) => !(BOTTOM_TABS as readonly string[]).includes(n.to));
  const moreActive = rest.some((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));

  return (
    <>
      <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2.5 px-4 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden">
        <div ref={pillRef} className="pill-host pointer-events-auto flex items-center gap-1 rounded-full border bg-popover/95 p-1.5 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55)] pointer-fine:bg-popover/80 pointer-fine:backdrop-blur-xl">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn('flex min-w-[64px] flex-col items-center gap-0.5 rounded-full px-3.5 py-2 text-[10.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
              }
            >
              <t.icon className="size-5" strokeWidth={1.9} />
              {t.short}
            </NavLink>
          ))}
          <button
            type="button"
            aria-current={moreActive ? 'page' : undefined}
            onClick={() => setMore(true)}
            className={cn('flex min-w-[64px] flex-col items-center gap-0.5 rounded-full px-3.5 py-2 text-[10.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', moreActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          >
            <Ellipsis className="size-5" strokeWidth={1.9} />
            More
          </button>
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add a transaction"
          className="pointer-events-auto grid size-[54px] shrink-0 place-items-center rounded-full bg-brand text-brand-foreground shadow-[0_12px_40px_-8px_rgb(0_0_0/0.55)] transition-transform duration-300 ease-[var(--spring-bouncy)] outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
        >
          <Plus className="size-6" strokeWidth={2.4} />
        </button>
      </nav>

      <Drawer open={more} onOpenChange={setMore}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>More</DrawerTitle>
            <DrawerDescription className="sr-only">Other parts of Spendly</DrawerDescription>
          </DrawerHeader>
          <div className="grid grid-cols-3 gap-2.5 px-4 pb-8">
            {rest.map((n) => (
              <button
                key={n.to}
                type="button"
                onClick={() => {
                  setMore(false);
                  navigate(n.to);
                }}
                className="flex flex-col items-center gap-2 rounded-3xl bg-muted px-2 py-4 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
              >
                <n.icon className="size-6" strokeWidth={1.8} />
                <span className="text-center leading-tight">{n.short}</span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

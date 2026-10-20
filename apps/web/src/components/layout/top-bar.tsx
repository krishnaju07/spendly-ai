import { useState } from 'react';
import { Bell, CheckCheck, Download, LogOut, Monitor, Moon, Search, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maskPhone, type NotificationDto } from '@spendly/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateRangePicker } from '@/components/common/date-range';
import { useSession } from '@/hooks/use-auth';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { useTheme, type ThemePreference } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { navForPath } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: NotificationDto[]; unread: number }>('/notifications'), refetchInterval: 60_000, staleTime: 20_000 });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const markRead = useMutation({ mutationFn: (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = q.data?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="icon" className="relative size-10 bg-card shadow-card hover:bg-card/80" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2.5" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--status-critical)] opacity-60" />
              <span className="absolute inset-0 rounded-full border-2 border-card bg-[var(--status-critical)]" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => readAll.mutate()}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[22rem] overflow-y-auto px-2 pb-2">
          {q.data?.items.length ? (
            q.data.items.slice(0, 12).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  if (n.link) navigate(n.link);
                  setOpen(false);
                }}
                className="flex w-full gap-3 rounded-2xl px-2.5 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : n.severity === 'warning' ? 'bg-[var(--status-warning)]' : 'bg-series-1')} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing yet. Budget alerts, upcoming payments and import updates show up here.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu() {
  const { user, logout } = useSession();
  const { theme, setTheme } = useTheme();
  const { updatePrefs } = useSession();
  const navigate = useNavigate();
  const { canInstall, install } = useInstallPrompt();
  const pick = (t: string) => {
    setTheme(t as ThemePreference);
    void updatePrefs({ theme: t as ThemePreference }).catch(() => undefined);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-sm font-semibold shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {initials(user.name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.isDemo ? 'Demo workspace — sample data' : user.phone ? maskPhone(user.phone) : ''}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <SettingsIcon /> Settings
        </DropdownMenuItem>
        {canInstall && (
          <DropdownMenuItem onSelect={() => void install()}>
            <Download /> Install app
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === 'light' ? <Sun /> : theme === 'dark' ? <Moon /> : <Monitor />} Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={pick}>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout().then(() => navigate('/login'))}>
          <LogOut /> {user.isDemo ? 'Exit demo' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const nav = navForPath(pathname);
  const [mac] = useState(() => /mac|iphone|ipad/i.test(navigator.userAgent));

  return (
    <div className="sticky top-[var(--banner-h,0px)] z-30 -mx-3 flex items-center gap-2 bg-gradient-to-b from-background via-background/90 to-transparent px-3 pt-3 pb-2 md:static md:mx-0 md:bg-none md:p-0 md:pt-0">
      <div className="md:hidden">
        <Logo compact />
      </div>
      {nav?.range && <DateRangePicker className="min-w-0" />}
      <div className="flex-1" />
      <Button variant="secondary" className="hidden h-10 w-64 justify-start gap-2 bg-card px-4 font-normal text-muted-foreground shadow-card hover:bg-card/80 lg:inline-flex" onClick={onSearch}>
        <Search className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">{mac ? '⌘' : 'Ctrl'} K</kbd>
      </Button>
      <Button variant="secondary" size="icon" className="size-10 bg-card shadow-card hover:bg-card/80 lg:hidden" onClick={onSearch} aria-label="Search">
        <Search className="size-[18px]" />
      </Button>
      <Notifications />
      <AccountMenu />
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef } from 'react';
import { CloudOff, FlaskConical } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/use-auth';
import { useOnline } from '@/hooks/use-online';

/** Demo data is always labelled — it must never be mistaken for real spending. */
export function DemoBanner() {
  const { isDemo, logout } = useSession();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // Sticky elements below (sidebar, mobile top bar) offset themselves by the banner's real height.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const set = () => root.style.setProperty('--banner-h', `${el.offsetHeight}px`);
    set();
    // the banner pads itself for the notch, so the top bar below it must not add that inset a second time
    root.style.setProperty('--safe-top', '0px');
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--banner-h');
      root.style.removeProperty('--safe-top');
    };
  }, [isDemo]);
  if (!isDemo) return null;
  return (
    <div ref={ref} role="status" className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-[var(--status-warning)] px-4 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 text-[13px] font-medium text-[#1f1300]">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>
        <strong>Demo workspace</strong> — sample data, not your real spending.
      </span>
      <Button size="xs" variant="outline" className="border-[#1f1300]/40 bg-transparent text-[#1f1300] hover:bg-[#1f1300]/10" onClick={() => void logout().then(() => navigate('/login'))}>
        Exit demo
      </Button>
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-muted px-4 py-2 text-[13px] text-muted-foreground">
      <CloudOff className="size-4" aria-hidden />
      You are offline. The app opens, but loading and saving need a connection.
    </div>
  );
}

/** PWA lifecycle: tells the user when an update is ready (they choose when to reload) and when offline use is available. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!offlineReady) return;
    toast.success('Spendly is ready to open offline.');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast('A new version of Spendly is ready.', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      cancel: { label: 'Later', onClick: () => setNeedRefresh(false) },
    });
    return () => void toast.dismiss(id);
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);
  return null;
}

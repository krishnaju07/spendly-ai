import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, LockKeyhole, RefreshCw, Unlink } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ProviderConnectionDto, ProviderSyncResultDto } from '@spendly/shared';
import { PlatformLogo } from '@/components/common/platform-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { systemPlatform } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { api } from '@/lib/api';

export const PROVIDERS_KEY = ['providers'] as const;

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const LINK_RESULTS: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: 'linked. Sync now to bring in your orders.' },
  denied: { ok: false, text: 'was not linked: the sign-in was cancelled.' },
  error: { ok: false, text: 'could not be linked. Please try again.' },
};

/** Tells the person how the trip to the service's own sign-in page went, once, and tidies the address. */
function useLinkResult() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const link = params.get('link');
  useEffect(() => {
    if (!link) return;
    const [id, result] = link.split(':');
    const r = LINK_RESULTS[result ?? ''];
    if (r && id) (r.ok ? toast.success : toast.error)(`${id.charAt(0).toUpperCase()}${id.slice(1)} ${r.text}`);
    void qc.invalidateQueries({ queryKey: PROVIDERS_KEY });
    setParams((p) => { const n = new URLSearchParams(p); n.delete('link'); return n; }, { replace: true });
  }, [link, qc, setParams]);
}

function Provider({ p }: { p: ProviderConnectionDto }) {
  const qc = useQueryClient();
  const invalidateMoney = useInvalidateMoney();
  const { prefs } = useSession();
  const ticked = p.platforms.some((s) => prefs.tracking.platforms.includes(s));
  const refresh = () => qc.invalidateQueries({ queryKey: PROVIDERS_KEY });
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.');

  // the person leaves for the service's own page (phone number and OTP there) and comes back to Settings
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/integrations/providers/${p.id}/connect`),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: fail,
  });
  const sync = useMutation({
    mutationFn: () => api.post<ProviderSyncResultDto>(`/integrations/providers/${p.id}/sync`),
    onSuccess: (r) => {
      toast.success(r.added ? `${r.added} new order${r.added === 1 ? '' : 's'} added` : 'Up to date: no new orders');
      r.notes.forEach((n) => toast.message(n));
      void invalidateMoney();
      void refresh();
    },
    onError: (e) => {
      fail(e);
      void refresh();
    },
  });
  const unlink = useMutation({ mutationFn: () => api.delete(`/integrations/providers/${p.id}`), onSuccess: () => { toast.success(`${p.name} unlinked`); void refresh(); }, onError: fail });
  const busy = connect.isPending || sync.isPending || unlink.isPending;
  const reconnect = p.lastError === 'reconnect';

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformLogo platform={systemPlatform(p.id)} size={36} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-medium">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {p.access === 'blocked' ? 'Waiting for Zomato to open access' : p.connected ? (p.lastSyncAt ? `Last synced ${when(p.lastSyncAt)}${p.lastSyncAdded ? ` · ${p.lastSyncAdded} new` : ''}` : 'Linked · not synced yet') : 'Not linked'}
          </p>
        </div>
        {p.access === 'blocked' ? (
          <Badge variant="default"><LockKeyhole /> Not available yet</Badge>
        ) : p.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            {reconnect ? (
              <Button size="sm" onClick={() => connect.mutate()} disabled={busy}><Link2 /> Sign in again</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => sync.mutate()} disabled={busy}><RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> {sync.isPending ? 'Syncing…' : 'Sync now'}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => unlink.mutate()} disabled={busy}><Unlink /> Unlink</Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => connect.mutate()} disabled={busy || !ticked}><Link2 /> {connect.isPending ? 'Opening…' : `Link ${p.name}`}</Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{p.note}</p>
      {p.access === 'available' && <p className="text-[13px] text-muted-foreground">{p.limits}</p>}
      {p.access === 'available' && !p.connected && !ticked && <p className="text-[13px] text-warn">Tick {p.name} in the list above and save, so Spendly knows it may read it.</p>}
      {reconnect && <p className="text-[13px] text-warn">{p.name} needs you to sign in again before Spendly can read new orders.</p>}
      {p.lastError && !reconnect && <p className="text-[13px] text-bad">The last sync failed: {p.lastError}</p>}
    </div>
  );
}

/** Real orders without a file: link the account, signing in on the service's own page. */
export function ProviderLinks() {
  useLinkResult();
  const q = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => api.get<ProviderConnectionDto[]>('/integrations/providers') });
  return (
    <Card className="gap-1">
      <h2 className="text-[15px] font-semibold tracking-tight">Link your accounts</h2>
      <p className="text-[13px] text-muted-foreground">Bring in real orders without a file. You sign in on the app’s own page — Spendly only receives permission to read your order history, never your password or OTP.</p>
      <div className="mt-3 divide-y">
        {q.isPending ? <Skeleton className="h-20 w-full rounded-2xl" /> : q.isError ? <p className="py-3 text-[13px] text-bad">Could not load your linked accounts.</p> : q.data.map((p) => <Provider key={p.id} p={p} />)}
      </div>
    </Card>
  );
}

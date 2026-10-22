import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, LockKeyhole, RefreshCw, Unlink } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ProviderConnectionDto, ProviderSyncResultDto } from '@spendly/shared';
import { SERVICE_NAMES } from '@/components/common/link-card';
import { PlatformLogo } from '@/components/common/platform-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { systemPlatform } from '@/hooks/use-catalog';
import { useInvalidateMoney } from '@/hooks/use-invalidate';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';
import { onLinkResult, openLinkWindow, type LinkResult } from '@/lib/link-channel';

export const PROVIDERS_KEY = ['providers'] as const;

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One sentence for how a trip to the service's sign-in went. */
function say(provider: string, result: LinkResult): void {
  const name = SERVICE_NAMES[provider] ?? 'Your account';
  if (result === 'ok') toast.success(`${name} is linked. Sync now to bring in your orders.`);
  else if (result === 'denied') toast.error('Nothing was linked: the sign-in was cancelled.');
  else toast.error(`${name === 'Your account' ? 'The account' : name} could not be linked. Please try again.`);
}

/** Tells the person how the trip to the service's own sign-in page went, once, and tidies the address (the same-tab route, when a window could not be opened). */
function useLinkResult() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const link = params.get('link');
  useEffect(() => {
    if (!link) return;
    const [id, result] = link.split(':');
    if (result === 'ok' || result === 'denied' || result === 'error') say(id ?? '', result);
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

  // the service's own page (phone number and OTP there) opens in a small window; this page stays where it is and hears back
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const stop = onLinkResult((m) => {
      setWaiting(false);
      say(m.provider || p.id, m.result);
      void refresh();
    });
    // a window closed without finishing sends nothing: do not wait for ever
    const timer = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => {
      stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  const connect = {
    isPending: waiting,
    mutate: () => {
      if (openLinkWindow(p.id)) setWaiting(true);
      // a blocked window: do it in this tab, and Settings says how it went when the person is brought back
      else window.location.assign(`/link?provider=${encodeURIComponent(p.id)}`);
    },
  };
  // a link not yet seen working on a real account shows what it found and waits for a yes before it saves anything
  const [review, setReview] = useState<ProviderSyncResultDto | null>(null);
  const sync = useMutation({
    mutationFn: (preview: boolean) => api.post<ProviderSyncResultDto>(`/integrations/providers/${p.id}/sync`, { preview }),
    onSuccess: (r, preview) => {
      r.notes.forEach((n) => toast.message(n));
      if (preview) {
        if (r.preview?.length) setReview(r);
        else toast.success(`Nothing new from ${p.name}`);
        return;
      }
      setReview(null);
      toast.success(r.added ? `${r.added} new order${r.added === 1 ? '' : 's'} added` : 'Up to date: no new orders');
      void invalidateMoney();
      void refresh();
    },
    onError: (e) => {
      fail(e);
      void refresh();
    },
  });
  const unlink = useMutation({ mutationFn: () => api.delete(`/integrations/providers/${p.id}`), onSuccess: () => { toast.success(`${p.name} unlinked`); void refresh(); }, onError: fail });
  const busy = waiting || sync.isPending || unlink.isPending;
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
              <Button size="sm" variant="secondary" onClick={() => sync.mutate(p.review && !p.lastSyncAt)} disabled={busy}><RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> {sync.isPending ? 'Syncing…' : 'Sync now'}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => unlink.mutate()} disabled={busy}><Unlink /> Unlink</Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => connect.mutate()} disabled={busy || !ticked}><Link2 /> {waiting ? 'Waiting for sign-in…' : `Link ${p.name}`}</Button>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{p.note}</p>
      {p.access === 'available' && <p className="text-[13px] text-muted-foreground">{p.limits}</p>}
      {p.id === 'zomato' && !p.connected && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-muted/60 px-3 py-2 text-[13px]">
          <span>The return address to ask Zomato to approve:</span>
          <code className="font-mono text-xs break-all">{p.returnAddress}</code>
          <button
            type="button"
            className="font-semibold underline underline-offset-3 hover:text-foreground"
            onClick={() => void navigator.clipboard.writeText(p.returnAddress).then(() => toast.success('Copied'), () => toast.error('Could not copy: select it and copy by hand'))}
          >
            Copy
          </button>
        </p>
      )}
      {p.access === 'available' && !p.connected && !ticked && <p className="text-[13px] text-warn">Tick {p.name} in the list above and save, so Spendly knows it may read it.</p>}
      {waiting && (
        <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
          Finish signing in to {p.name} in the window that just opened.
          <button type="button" className="font-semibold underline underline-offset-3 hover:text-foreground" onClick={() => { if (!openLinkWindow(p.id)) setWaiting(false); }}>Bring it back</button>
          <button type="button" className="underline underline-offset-3 hover:text-foreground" onClick={() => setWaiting(false)}>Cancel</button>
        </p>
      )}
      <Dialog open={review !== null} onOpenChange={(open) => !open && setReview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Check what {p.name} sent</DialogTitle>
            <DialogDescription>This is the first time Spendly has read {p.name}. Nothing is saved until you say so: look at the dates and amounts, and only add them if they match your {p.name} app.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-2xl border" aria-label={`Orders found on ${p.name}`}>
            {review?.preview?.map((o, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.description}</span>
                  <span className="text-xs text-muted-foreground">{new Date(o.date).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{o.status === 'pending' ? ' · in progress' : ''}</span>
                </span>
                <span className="tnum shrink-0 font-semibold">{inr(o.amountPaise)}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReview(null)}>Not now</Button>
            <Button onClick={() => sync.mutate(false)} disabled={sync.isPending}>{sync.isPending ? 'Adding…' : `Add ${review?.preview?.length ?? 0} order${review?.preview?.length === 1 ? '' : 's'}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

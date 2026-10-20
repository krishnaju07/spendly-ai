import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { formatPhone, type SessionDto } from '@spendly/shared';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { describeAgent } from '@/lib/agent';
import { formatDate } from '@/lib/format';

function MobileNumber() {
  const { user } = useSession();
  return (
    <Card className="gap-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">Mobile number</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">You sign in with a code texted to this number, so there is no password to remember, reuse or leak.</p>
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><Smartphone className="size-[18px]" aria-hidden /></span>
        <span className="tnum text-[15px] font-medium">{user.phone ? formatPhone(user.phone) : '—'}</span>
        <Badge variant="ok" className="ml-auto">Verified by code</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Changing the number on an account is not available yet. To use a different number, create a new account and export your data first.</p>
    </Card>
  );
}

function Sessions() {
  const { prefs } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionDto[]>('/auth/sessions') });
  const [ending, setEnding] = useState<SessionDto | null>(null);
  const end = useMutation({
    mutationFn: (s: SessionDto) => api.delete(`/auth/sessions/${s.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Signed out of that device');
      setEnding(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not sign out that device'),
  });
  return (
    <Card className="gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">Where you are signed in</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">If you do not recognise a device, sign it out.</p>
      </div>
      {q.isPending ? <Skeleton className="h-32 rounded-2xl" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : (
        <ul className="divide-y">
          {q.data.map((s) => {
            const Icon = /iphone|android|ipad/i.test(s.userAgent) ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><Icon className="size-[18px]" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{describeAgent(s.userAgent)}{s.current && <Badge variant="ok">This device</Badge>}</p>
                  <p className="text-xs text-muted-foreground tnum">{s.ip} · active {formatDate(s.lastSeenAt, prefs.timezone, 'long')}</p>
                </div>
                {!s.current && <Button size="sm" variant="secondary" onClick={() => setEnding(s)}><LogOut /> Sign out</Button>}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog open={Boolean(ending)} onOpenChange={(o) => !o && setEnding(null)} title="Sign out that device?" description={ending ? `${describeAgent(ending.userAgent)} will need to sign in again.` : ''} confirmLabel="Sign out" destructive pending={end.isPending} onConfirm={() => ending && end.mutate(ending)} />
    </Card>
  );
}

export function SecuritySettings() {
  const { isDemo } = useSession();
  return (
    <div className="space-y-4">
      {isDemo ? (
        <Card className="gap-2"><h2 className="text-[15px] font-semibold tracking-tight">Demo workspace</h2><p className="text-[13px] text-muted-foreground">This temporary workspace has no sign-in and is deleted automatically. Create an account with your mobile number to keep your own data.</p></Card>
      ) : (
        <MobileNumber />
      )}
      <Sessions />
    </div>
  );
}

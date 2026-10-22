import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileJson, FileSpreadsheet, FileText, FileUp, Smartphone, Trash2 } from 'lucide-react';
import { maskPhone } from '@spendly/shared';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Field } from '@/components/common/field';
import { SettingRow, SettingsCard } from '@/components/settings/setting-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSession } from '@/hooks/use-auth';
import { useCountdown, type Cooldown } from '@/hooks/use-countdown';
import { ApiRequestError, api } from '@/lib/api';

function DeleteAccount() {
  const { user, isDemo, logout, requestCode } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirm, setConfirm] = useState('');
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const left = useCountdown(cooldown);
  const phone = user.phone ?? '';

  // erasing everything needs a fresh code texted to the owner, not just a signed-in browser
  const send = useMutation({
    mutationFn: () => requestCode(phone),
    onSuccess: (r) => {
      setCooldown({ seconds: r.resendInSeconds });
      setDevCode(r.devCode ?? null);
      toast.success(r.devCode ? 'Test mode: the code is shown below' : `Code sent to ${maskPhone(phone)}`);
    },
  });
  const del = useMutation({
    mutationFn: () => api.delete('/settings/account', { otp: isDemo ? undefined : otp, confirm: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Your account and data were deleted');
      await logout().catch(() => undefined);
      navigate('/login', { replace: true });
    },
  });
  const failed = del.error ?? send.error;
  const error = failed instanceof ApiRequestError ? failed.message : failed ? 'Something went wrong. Please try again.' : null;
  const ready = confirm === 'DELETE' && (isDemo || /^\d{6}$/.test(otp));
  const close = () => {
    setOpen(false);
    del.reset();
    send.reset();
    setOtp('');
    setConfirm('');
    setCooldown(null);
    setDevCode(null);
  };
  return (
    <Card className="gap-3 border-[var(--status-critical)]/40">
      <h2 className="text-[15px] font-semibold tracking-tight text-bad">Delete {isDemo ? 'this demo workspace' : 'your account'}</h2>
      <p className="text-[13px] text-muted-foreground">Permanently removes your profile, transactions, budgets, goals, rules, imported files and sessions. It cannot be undone — export your data first if you want a copy.</p>
      <div><Button variant="destructive" onClick={() => setOpen(true)}><Trash2 /> Delete everything</Button></div>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete everything?</DialogTitle>
            <DialogDescription>
              This is permanent. {isDemo ? 'The demo data will be removed.' : `We will text a code to ${maskPhone(phone)} to confirm it is you, then type DELETE.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (ready) del.mutate(); }} className="space-y-4">
            {!isDemo && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" disabled={send.isPending || left > 0} onClick={() => send.mutate()}>
                    <Smartphone /> {send.isPending ? 'Sending…' : left > 0 ? `Send again in ${left}s` : cooldown ? 'Send a new code' : 'Text me a code'}
                  </Button>
                  {devCode && <span className="rounded-full bg-muted px-3 py-1.5 text-xs">Test mode — your code is<b className="tnum tracking-[0.14em]">{devCode}</b></span>}
                </div>
                <Field label="6-digit code" htmlFor="del-otp">
                  <Input id="del-otp" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} disabled={!cooldown} placeholder={cooldown ? '' : 'Ask for a code first'} className="tnum tracking-[0.3em]" />
                </Field>
              </>
            )}
            <Field label="Type DELETE to confirm" htmlFor="del-confirm"><Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
            {error && <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!ready || del.isPending}>{del.isPending ? 'Deleting…' : 'Delete permanently'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function DataSettings() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      <SettingsCard title="Bring in data" description="Add real spending from a statement or receipt you download yourself. You check it before anything is saved.">
        <SettingRow title="Import a statement or receipt" description="CSV, Excel, a text PDF or an emailed receipt. Spendly never logs in to your apps.">
          <Button variant="secondary" asChild><Link to="/import"><FileUp /> Open Import</Link></Button>
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Export your data" description="Your data is yours. Take a full copy any time, in open formats.">
        <SettingRow title="Everything (JSON)" description="Profile, preferences, transactions, budgets, goals, rules, recurring payments and import history. Amounts are in paise (₹1 = 100 paise).">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run('json', () => api.download('/settings/export', undefined, 'spendly-export.json'))}><FileJson /> {busy === 'json' ? 'Preparing…' : <><Download /> Download</>}</Button>
        </SettingRow>
        <SettingRow title="Transactions (CSV)" description="Every transaction in a spreadsheet-friendly file that opens in Excel or Google Sheets.">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run('csv', () => api.download('/transactions/export', undefined, 'spendly-transactions.csv'))}><FileSpreadsheet /> {busy === 'csv' ? 'Preparing…' : <><Download /> Download</>}</Button>
        </SettingRow>
        <SettingRow title="Transactions (PDF)" description="A printable statement: totals first, then every transaction, newest first. Long histories stop at the newest 10,000 rows; the CSV and JSON hold everything.">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run('pdf', () => api.download('/transactions/export', { format: 'pdf' }, 'spendly-transactions.pdf'))}><FileText /> {busy === 'pdf' ? 'Preparing…' : <><Download /> Download</>}</Button>
        </SettingRow>
      </SettingsCard>
      <DeleteAccount />
    </div>
  );
}

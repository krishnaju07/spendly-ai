import { useState } from 'react';
import { AppWindow, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { TrackList } from '@/components/auth/track-list';
import { AppGuides } from '@/components/settings/app-guides';
import { ProviderLinks } from '@/components/settings/provider-links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/hooks/use-auth';

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((s) => b.includes(s));

/** The food and entertainment apps Spendly may track: the list chosen at sign-up, and where it can be changed. */
export function TrackedAppsSettings() {
  const { prefs, updatePrefs } = useSession();
  const saved = prefs.tracking.platforms;
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const changed = !sameList(draft, saved);
  const since = prefs.tracking.consentedAt ? new Date(prefs.tracking.consentedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  const save = () => {
    setSaving(true);
    updatePrefs({ tracking: { platforms: draft } })
      .then(() => toast.success(draft.length ? 'Tracked apps updated' : 'Tracking switched off'))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save that list'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><AppWindow className="size-[18px]" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">Apps Spendly tracks</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Food, grocery and entertainment apps only. Spendly looks for these in the statements, receipts and entries you add — it never signs in to them and never holds their passwords.</p>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          {saved.length ? <Badge variant="ok">{saved.length} allowed{since ? ` · since ${since}` : ''}</Badge> : <Badge variant="default">Nothing allowed yet</Badge>}
        </p>
      </Card>

      <Card className="gap-4">
        <TrackList value={draft} onChange={setDraft} disabled={saving} scroll={false} />
        <p className="flex items-start gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Saving records today as the date you allowed these apps. Untick everything and save to withdraw.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={!changed || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          {changed && <Button variant="ghost" onClick={() => setDraft(saved)} disabled={saving}>Discard</Button>}
        </div>
      </Card>

      <ProviderLinks />
      <AppGuides />
    </div>
  );
}

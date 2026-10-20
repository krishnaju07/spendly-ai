import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AiStatusDto } from '@spendly/shared';
import { SettingRow, SettingsCard } from '@/components/settings/setting-row';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/hooks/use-auth';
import { api } from '@/lib/api';

export function AiPrivacySettings() {
  const { prefs, updatePrefs } = useSession();
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatusDto>('/ai/status') });
  const s = status.data;
  const configured = s?.provider.configured ?? false;
  const set = (patch: Parameters<typeof updatePrefs>[0]) => updatePrefs(patch).then(() => { void status.refetch(); }).catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save that setting'));
  const on = prefs.ai.enabled && configured;

  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><ShieldCheck className="size-[18px]" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">Your data and AI</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Spendly works fully without AI. Every number is calculated from your transactions by the app itself. If you switch AI on, it can only reword answers, suggest a category for merchants the rules cannot place, or read receipt photos — and only with the permissions below.</p>
          </div>
        </div>
        {status.isPending ? <Skeleton className="h-6 w-56" /> : (
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            {configured ? <Badge variant="ok">Provider ready · {s?.provider.name}{s?.provider.model ? ` · ${s.provider.model}` : ''}</Badge> : <Badge variant="default">No AI provider is configured on this server</Badge>}
            {on ? <Badge variant="ok">AI is on for you</Badge> : <Badge variant="default">AI is off for you</Badge>}
          </p>
        )}
        {!configured && !status.isPending && <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">Whoever runs this server can enable AI by setting <code className="font-mono text-xs">AI_PROVIDER</code> and <code className="font-mono text-xs">AI_API_KEY</code> in its environment. Nothing here needs it.</p>}
      </Card>

      <SettingsCard title="Permissions" description="Each option is separate and off until you turn it on.">
        <SettingRow title="Use AI at all" htmlFor="ai-on" description="The master switch. While it is off nothing is ever sent to an AI provider.">
          <Switch id="ai-on" checked={prefs.ai.enabled} disabled={!configured} onCheckedChange={(v) => void set({ ai: { enabled: v } })} />
        </SettingRow>
        <SettingRow title="Let AI see merchant names" htmlFor="ai-names" description="Off: only totals and percentages are shared. On: merchant and platform names are included so wording can be more specific.">
          <Switch id="ai-names" checked={prefs.ai.shareMerchantNames} disabled={!on} onCheckedChange={(v) => void set({ ai: { shareMerchantNames: v } })} />
        </SettingRow>
        <SettingRow title="Help classify unknown merchants" htmlFor="ai-classify" description="Sends only the merchant text of transactions the built-in rules could not place, to suggest a platform and category. You still review the result.">
          <Switch id="ai-classify" checked={prefs.ai.classifyUnknownMerchants} disabled={!on} onCheckedChange={(v) => void set({ ai: { classifyUnknownMerchants: v } })} />
        </SettingRow>
        <SettingRow title="Read receipt photos" htmlFor="ai-receipts" description="Sends the receipt image you upload to read the merchant, date and total. Without this, you fill those in yourself.">
          <Switch id="ai-receipts" checked={prefs.ai.readReceipts} disabled={!on} onCheckedChange={(v) => void set({ ai: { readReceipts: v } })} />
        </SettingRow>
      </SettingsCard>

      {s && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">What can be sent</h2>
            <p className="text-[13px] text-muted-foreground">Only when the matching permission is on.</p>
            <ul className="mt-1 list-disc space-y-1.5 pl-5 text-[13px]">{s.sends.map((x) => <li key={x}>{x}</li>)}</ul>
          </Card>
          <Card className="gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">What is never sent</h2>
            <p className="text-[13px] text-muted-foreground">Regardless of any setting.</p>
            <ul className="mt-1 list-disc space-y-1.5 pl-5 text-[13px]">{s.neverSends.map((x) => <li key={x}>{x}</li>)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}

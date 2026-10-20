import { useMemo } from 'react';
import { CloudOff, MonitorSmartphone, Share, SquarePlus } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { RANGE_PRESETS, formatPhone, type PreferencesUpdate, type RangePreset } from '@spendly/shared';
import { RANGE_LABELS } from '@/components/common/date-range';
import { Segmented } from '@/components/common/segmented';
import { PageHeader } from '@/components/common/states';
import { AiPrivacySettings } from '@/components/settings/ai-privacy';
import { CustomCategories } from '@/components/settings/categories';
import { DataSettings } from '@/components/settings/data-danger';
import { SecuritySettings } from '@/components/settings/security';
import { SettingRow, SettingsCard } from '@/components/settings/setting-row';
import { TypefacePicker } from '@/components/settings/typeface-picker';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/hooks/use-auth';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { initials } from '@/lib/format';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'security', label: 'Security' },
  { id: 'ai', label: 'AI & privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'data', label: 'Your data' },
  { id: 'app', label: 'App' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function useSave() {
  const { updatePrefs } = useSession();
  return (patch: PreferencesUpdate, message = 'Saved') => updatePrefs(patch).then(() => toast.success(message)).catch((e) => toast.error(e instanceof Error ? e.message : 'Could not save that setting'));
}

function General() {
  const { user, prefs, isDemo } = useSession();
  const save = useSave();
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'UTC'];
    return all.includes(prefs.timezone) ? all : [prefs.timezone, ...all];
  }, [prefs.timezone]);
  return (
    <div className="space-y-4">
      <Card className="flex-row items-center gap-4">
        <Avatar className="size-14"><AvatarFallback className="bg-muted text-lg font-semibold">{initials(user.name)}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-lg leading-tight font-semibold tracking-tight">{user.name}{isDemo && <Badge variant="warn">Demo</Badge>}</p>
          <p className="truncate text-[13px] text-muted-foreground">{isDemo ? 'A temporary workspace with sample data' : user.phone ? formatPhone(user.phone) : ''}</p>
        </div>
      </Card>

      <SettingsCard title="Appearance and region">
        <SettingRow title="Theme" description="Dark is the default. System follows your device.">
          <Segmented label="Theme" value={prefs.theme} onChange={(v) => void save({ theme: v }, 'Theme updated')} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
        </SettingRow>
        <SettingRow title="Time zone" description="Decides which day a late-night transaction belongs to, and when a month starts.">
          <Select value={prefs.timezone} onValueChange={(v) => void save({ timezone: v })}>
            <SelectTrigger className="h-11 w-64 max-w-full rounded-2xl" aria-label="Time zone"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="Date format">
          <Select value={prefs.dateFormat} onValueChange={(v) => void save({ dateFormat: v as typeof prefs.dateFormat })}>
            <SelectTrigger className="h-11 w-48 rounded-2xl" aria-label="Date format"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="DD/MM/YYYY">31/12/2026</SelectItem><SelectItem value="MM/DD/YYYY">12/31/2026</SelectItem><SelectItem value="YYYY-MM-DD">2026-12-31</SelectItem></SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="Week starts on">
          <Select value={String(prefs.weekStartsOn)} onValueChange={(v) => void save({ weekStartsOn: Number(v) as 1 | 7 })}>
            <SelectTrigger className="h-11 w-48 rounded-2xl" aria-label="Week starts on"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="1">Monday</SelectItem><SelectItem value="7">Sunday</SelectItem></SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="Default period" description="What the date range shows when you open a page.">
          <Select value={prefs.defaultRange} onValueChange={(v) => void save({ defaultRange: v as Exclude<RangePreset, 'custom'> })}>
            <SelectTrigger className="h-11 w-56 rounded-2xl" aria-label="Default period"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">{RANGE_PRESETS.filter((p) => p !== 'custom').map((p) => <SelectItem key={p} value={p}>{RANGE_LABELS[p]}</SelectItem>)}</SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="Currency" description="Everything is tracked in Indian rupees, stored exactly in paise.">
          <Badge variant="outline">INR ₹</Badge>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Typeface" description="How text and figures look. This is a display choice kept on this device; the change applies everywhere at once.">
        <div className="pt-1">
          <TypefacePicker />
        </div>
      </SettingsCard>

      <SettingsCard title="Income">
        <SettingRow title="Track income" htmlFor="income" description="Show salary and other credits next to your spending. Off keeps Spendly focused on spending only.">
          <Switch id="income" checked={prefs.incomeTracking} onCheckedChange={(v) => void save({ incomeTracking: v })} />
        </SettingRow>
      </SettingsCard>

      <CustomCategories />
    </div>
  );
}

function Notifications() {
  const { prefs } = useSession();
  const save = useSave();
  const rows: Array<{ key: keyof typeof prefs.notifications; title: string; description: string }> = [
    { key: 'budgetAlerts', title: 'Budget alerts', description: 'When spending reaches the levels you chose for a budget.' },
    { key: 'upcomingPayments', title: 'Upcoming payments', description: 'A reminder before a confirmed subscription or bill is expected.' },
    { key: 'importUpdates', title: 'Import updates', description: 'When a file you uploaded is ready to review, or finishes.' },
    { key: 'insights', title: 'New insights', description: 'When Spendly notices something worth a look in your spending.' },
  ];
  return (
    <SettingsCard title="In-app notifications" description="These appear under the bell at the top. Spendly does not send emails or push messages.">
      {rows.map((r) => (
        <SettingRow key={r.key} title={r.title} htmlFor={`n-${r.key}`} description={r.description}>
          <Switch id={`n-${r.key}`} checked={prefs.notifications[r.key]} onCheckedChange={(v) => void save({ notifications: { [r.key]: v } })} />
        </SettingRow>
      ))}
    </SettingsCard>
  );
}

function AppTab() {
  const { canInstall, installed, ios, install } = useInstallPrompt();
  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><MonitorSmartphone className="size-[18px]" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">Install Spendly</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Add it to your home screen or desktop to open it like any other app, full screen and without browser bars.</p>
          </div>
        </div>
        {installed ? <p><Badge variant="ok">Installed on this device</Badge></p> : canInstall ? (
          <div><Button onClick={() => void install()}><SquarePlus /> Install Spendly</Button></div>
        ) : ios ? (
          <ol className="list-decimal space-y-1.5 rounded-2xl bg-muted/60 py-3 pr-4 pl-9 text-[13px]">
            <li>Tap the <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share button in Safari.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
        ) : (
          <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">Use your browser’s menu and choose <strong className="font-medium text-foreground">Install app</strong> or <strong className="font-medium text-foreground">Add to Home screen</strong>. On desktop Chrome and Edge there is an install icon at the right end of the address bar.</p>
        )}
      </Card>
      <Card className="gap-2">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"><CloudOff className="size-[18px]" aria-hidden /></span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Offline</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">The app itself opens without a connection. Your financial data is never stored for offline use — it loads from the server and needs a connection to load or save. That keeps it off the device if the device is lost.</p>
          </div>
        </div>
      </Card>
      <Card className="gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Spendly AI</h2>
        <p className="text-[13px] text-muted-foreground">Every rupee tracked. Every decision smarter. Spendly recognises spending from statements and receipts you provide; it never logs in to your bank or shopping accounts.</p>
      </Card>
    </div>
  );
}

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'general';
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Preferences, security, privacy and your data." />
      <Tabs value={tab} onValueChange={(v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'general') n.delete('tab'); else n.set('tab', v); return n; }, { replace: true })}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Settings sections" className="w-max">{TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>
        </div>
      </Tabs>
      <div className="max-w-3xl">
        {tab === 'general' && <General />}
        {tab === 'security' && <SecuritySettings />}
        {tab === 'ai' && <AiPrivacySettings />}
        {tab === 'notifications' && <Notifications />}
        {tab === 'data' && <DataSettings />}
        {tab === 'app' && <AppTab />}
      </div>
    </div>
  );
}

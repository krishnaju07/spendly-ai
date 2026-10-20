import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

/** A titled group of settings: each row has a label, a plain-language explanation and its control. */
export function SettingsCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="gap-1">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-3 divide-y">{children}</div>
    </Card>
  );
}

export function SettingRow({ title, description, htmlFor, children }: { title: string; description?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 first:pt-1 last:pb-1">
      <div className="min-w-0 flex-1 basis-64">
        <Label htmlFor={htmlFor} className="text-sm font-medium">{title}</Label>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

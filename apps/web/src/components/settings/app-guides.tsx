import { ChevronDown, FileUp } from 'lucide-react';
import { Link } from 'react-router';
import { APP_GUIDES, type AppGuide } from '@spendly/shared';
import { PlatformLogo } from '@/components/common/platform-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/hooks/use-auth';
import { systemPlatform } from '@/hooks/use-catalog';

function Row({ guide, tracked }: { guide: AppGuide; tracked: boolean }) {
  const platform = systemPlatform(guide.slug);
  return (
    <details className="group py-3 first:pt-1 last:pb-1">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <PlatformLogo platform={platform} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{platform?.name ?? guide.slug}</span>
          <span className="block text-xs text-muted-foreground">{guide.status}</span>
        </span>
        {!tracked && <Badge variant="default">Not tracked</Badge>}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="mt-4 space-y-5 sm:pl-12">
        {guide.ways.map((way) => (
          <section key={way.title} className="space-y-2">
            <h3 className="text-[13px] font-semibold">{way.title}</h3>
            <p className="text-xs text-muted-foreground">You upload: {way.accepts}</p>
            <ol className="list-decimal space-y-1 pl-5 text-[13px]">
              {way.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {way.accepts !== 'Nothing to upload' && (
              <Button asChild size="sm" variant="secondary">
                <Link to={`/import?kind=${way.importKind}`}><FileUp /> Open Import</Link>
              </Button>
            )}
          </section>
        ))}
        {guide.unverified.length > 0 && (
          <section className="rounded-2xl bg-muted/60 px-4 py-3">
            <h3 className="text-[13px] font-semibold">What we could not confirm</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
              {guide.unverified.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}

/** The apps with no sign-in of their own: for each, the ways to bring its real spending in, from what the app itself says. */
export function AppGuides() {
  const { prefs } = useSession();
  const tracked = new Set(prefs.tracking.platforms);
  // the apps you ticked come first
  const guides = [...APP_GUIDES].sort((a, b) => Number(tracked.has(b.slug)) - Number(tracked.has(a.slug)));
  return (
    <Card className="gap-1">
      <h2 className="text-[15px] font-semibold tracking-tight">Other apps</h2>
      <p className="text-[13px] text-muted-foreground">These apps do not let Spendly sign in to them, so you bring their spending in yourself: download your own receipt or export, then upload it in Import. You check every row before anything is saved. What each app does and does not offer comes from its own pages; where that could not be confirmed, it says so.</p>
      <div className="mt-3 divide-y">
        {guides.map((g) => <Row key={g.slug} guide={g} tracked={tracked.has(g.slug)} />)}
      </div>
    </Card>
  );
}

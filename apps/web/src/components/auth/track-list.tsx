import { Check } from 'lucide-react';
import { TRACK_SECTIONS, TRACKABLE_SLUGS } from '@spendly/shared';
import { PlatformLogo } from '@/components/common/platform-logo';
import { systemPlatform } from '@/hooks/use-catalog';
import { cn } from '@/lib/utils';
import '@/styles/track.css';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Keep the list to a fixed height and scroll inside it (the sign-up card); off where the page can simply grow. */
  scroll?: boolean;
}

/**
 * The food and entertainment apps Spendly can be asked to keep track of. Nothing is ticked until the person
 * ticks it: this list is the consent, so it starts empty.
 */
export function TrackList({ value, onChange, disabled, scroll = true }: Props) {
  const all = value.length === TRACKABLE_SLUGS.length;
  const toggle = (slug: string) => onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
        <span className="tnum text-muted-foreground" aria-live="polite">
          {value.length} of {TRACKABLE_SLUGS.length} allowed
        </span>
        <button type="button" className="rounded-md font-semibold underline underline-offset-3 outline-none hover:text-series-7 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" disabled={disabled} onClick={() => onChange(all ? [] : [...TRACKABLE_SLUGS])}>
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className={cn('space-y-4', scroll && 'track-scroll scrollbar-none')}>
        {TRACK_SECTIONS.map((section) => (
          <fieldset key={section.id} disabled={disabled} className="min-w-0">
            <legend className="mb-2 flex w-full items-baseline gap-2">
              <span className="text-[13px] font-semibold">{section.title}</span>
              <span className="text-xs text-muted-foreground">{section.hint}</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 max-[359px]:grid-cols-1">
              {section.slugs.map((slug) => {
                const platform = systemPlatform(slug);
                if (!platform) return null;
                const on = value.includes(slug);
                return (
                  <label key={slug} className="track-item" data-on={on}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(slug)} />
                    <PlatformLogo platform={platform} size={26} />
                    <span className="min-w-0 flex-1 text-[13px] leading-tight font-medium">{platform.name}</span>
                    <span className="track-tick" aria-hidden>
                      <Check className="size-2.5" strokeWidth={3.6} />
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

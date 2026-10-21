import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { PlatformLogo } from '@/components/common/platform-logo';
import { systemPlatform, type PlatformView } from '@/hooks/use-catalog';
import { prefersReducedMotion } from '@/hooks/use-reduced-motion';
import { Odometer } from './odometer';

const vars = (v: Record<string, string | number>) => v as CSSProperties;

// ── headline ───────────────────────────────────────────────────────────────────────────────────

function Words({ text, start }: { text: string; start: number }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="w" style={vars({ '--i': start + i })}>
            {w}
          </span>
        </span>
      ))}
    </>
  );
}

export function Headline() {
  return (
    <h1 className="hero-title">
      <Words text="Every rupee" start={0} />{' '}
      <span className="w tracked" style={vars({ '--i': 2 })}>
        tracked.
        <svg className="squiggle" viewBox="0 0 200 12" aria-hidden>
          <path d="M2 7 C 22 -1, 42 15, 62 7 S 102 -1, 122 7 S 162 15, 198 6" pathLength={1} />
        </svg>
      </span>
      <br />
      <span className="dim">
        <Words text="Every decision smarter." start={3} />
      </span>
    </h1>
  );
}

// ── the stage ──────────────────────────────────────────────────────────────────────────────────

/** Arc lengths and starts are in percent of the circle: four fifths of it is segments, the rest gaps. */
const ARCS = [
  { len: 26, start: 1.8, color: 'var(--series-7)' },
  { len: 18, start: 31.4, color: 'var(--series-1)' },
  { len: 13, start: 53, color: 'var(--series-5)' },
  { len: 16, start: 69.6, color: 'var(--series-4)' },
  { len: 9, start: 89.2, color: 'var(--series-3)' },
];
const CHIPS = ['zomato', 'swiggy', 'zepto', 'blinkit', 'bookmyshow', 'district', 'netflix', 'spotify'];
const AMOUNTS = ['1,09,462.90', '1,12,806.45', '1,06,129.10', '1,18,377.65'];

/** A decorative scene — a segmented ring, platforms in orbit and a counter that rolls. The figures are samples. */
export function HeroStage() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setN((v) => (v + 1) % AMOUNTS.length), 3800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="stage-wrap" aria-hidden>
      <div className="stage">
        <div className="stage-glow" />
        <svg className="stage-svg" viewBox="0 0 400 400">
          <g className="spin-rev">
            <circle cx="200" cy="200" r="188" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="5" strokeDasharray="1.2 13" />
          </g>
          <circle cx="200" cy="200" r="168" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          <circle cx="200" cy="200" r="140" fill="none" stroke="var(--ring-track)" strokeWidth="26" />
          <g className="spin-slow">
            {ARCS.map((a, i) => (
              <circle key={i} className="ring-arc" cx="200" cy="200" r="140" pathLength={100} style={{ ...vars({ '--len': a.len, '--start': a.start, '--i': i }), stroke: a.color }} />
            ))}
          </g>
          <g className="spin-rev">
            <circle cx="200" cy="200" r="104" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" strokeDasharray="2 9" />
          </g>
          <g className="spin-orbit">
            <circle cx="200" cy="96" r="12" fill="var(--series-7)" opacity="0.35" />
            <circle cx="200" cy="96" r="5.5" fill="#fff" />
          </g>
        </svg>

        <div className="orbit-layer">
          {CHIPS.map((slug, i) => (
            <div key={slug} className="orbit-arm" style={vars({ '--a': `${i * 45 + 18}deg` })}>
              <div className="orbit-pos">
                <div className="orbit-upright">
                  <div className="orbit-counter">
                    <div className="orbit-chip" style={vars({ '--i': i })}>
                      <div className="orbit-float" style={vars({ '--i': i })}>
                        <PlatformLogo platform={systemPlatform(slug)} size={34} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="stage-center">
          <p className="stage-label">This month</p>
          <Odometer value={`₹${AMOUNTS[n]}`} className="stage-amount" />
          <p className="stage-sub">
            <i /> 55 purchases
          </p>
        </div>
      </div>
      <Feed />
      <div className="coach-bubble">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--series-7)] text-white">
          <Sparkles className="size-3.5" />
        </span>
        <span>
          Dining out is 44% lower than last month.
          <br />
          <span className="badge">Verified from your data</span>
        </span>
      </div>
    </div>
  );
}

// ── a few transactions arriving ────────────────────────────────────────────────────────────────

interface FeedItem {
  slug: string;
  title: string;
  sub: string;
  amount: string;
  plus?: boolean;
}
const FEED: FeedItem[] = [
  { slug: 'swiggy', title: 'Swiggy', sub: 'Food delivery', amount: '−₹486' },
  { slug: 'spotify', title: 'Spotify', sub: 'Music', amount: '−₹119' },
  { slug: 'netflix', title: 'Netflix', sub: 'Subscription', amount: '−₹649' },
  { slug: 'zomato', title: 'Zomato', sub: 'Refund', amount: '+₹329', plus: true },
  { slug: 'zepto', title: 'Zepto', sub: 'Groceries', amount: '−₹346.95' },
  { slug: 'bookmyshow', title: 'BookMyShow', sub: 'Entertainment', amount: '−₹640' },
  { slug: 'district', title: 'District', sub: 'Events', amount: '−₹1,498' },
  { slug: 'blinkit', title: 'Blinkit', sub: 'Groceries', amount: '−₹412' },
];

function Feed() {
  const counter = useRef(3);
  const [items, setItems] = useState(() => [2, 1, 0].map((id) => ({ ...FEED[id]!, id })));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => {
      const next = counter.current++;
      setItems((cur) => [{ ...FEED[next % FEED.length]!, id: next }, ...cur].slice(0, 4));
    }, 2700);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="feed">
      {items.map((it, pos) => (
        <div key={it.id} className="feed-card" style={vars({ '--pos': pos })}>
          <PlatformLogo platform={systemPlatform(it.slug)} size={34} />
          <div className="min-w-0">
            <p className="t">{it.title}</p>
            <p className="s">{it.sub}</p>
          </div>
          <span className={it.plus ? 'a plus' : 'a'}>{it.amount}</span>
        </div>
      ))}
    </div>
  );
}

// ── the ribbon of platforms ────────────────────────────────────────────────────────────────────

const RIBBON = ['zomato', 'swiggy', 'zepto', 'blinkit', 'swiggy-instamart', 'bigbasket', 'bookmyshow', 'district', 'paytm-insider', 'netflix', 'spotify', 'youtube-premium', 'prime-video', 'jiohotstar'];

export function Ribbon() {
  const items = RIBBON.map(systemPlatform).filter((p): p is PlatformView => p !== null);
  return (
    <div>
      <p className="marquee-caption">Recognises food and entertainment spending across</p>
      <div className="marquee" aria-hidden>
        <div className="marquee-track">
          {[...items, ...items].map((p, i) => (
            <span key={i} className="marquee-item">
              <PlatformLogo platform={p} size={26} />
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const SampleNote = () => <p className="sample-note">Illustration with sample figures</p>;

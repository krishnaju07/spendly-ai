import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AuroraBackdrop } from '@/components/auth/backdrop';
import { AuthCard, type Mode, type VerifyInput, type VerifyOutcome, type Welcome } from '@/components/auth/auth-card';
import { Headline, HeroStage, Ribbon, SampleNote } from '@/components/auth/hero';
import { Logo } from '@/components/layout/logo';
import { useAuth } from '@/hooks/use-auth';
import { useAuthConfig } from '@/hooks/use-auth-config';
import { usePointerVars } from '@/hooks/use-pointer-vars';
import '@/styles/auth.css';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign in and create an account share one page, so the scene on the left keeps playing while the
 * card on the right morphs between the two. On success the card sinks, the stage swells away and
 * the app takes over.
 */
export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mode: Mode = location.pathname.startsWith('/register') ? 'register' : 'login';
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const root = useRef<HTMLDivElement>(null);
  usePointerVars(root);

  const config = useAuthConfig();
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);
  const [welcome, setWelcome] = useState<Welcome>(false);
  const [exit, setExit] = useState(false);

  useEffect(() => {
    document.title = mode === 'register' ? 'Create your account · Spendly' : 'Sign in · Spendly';
  }, [mode]);

  // someone who is already signed in goes straight to the app — but not while we are playing the exit
  if (auth.status === 'authed' && busy === null) return <Navigate to={from} replace />;

  /** The card sinks, the stage swells away, then the app takes over. */
  const finish = async (isNew: boolean) => {
    setWelcome(isNew ? 'new' : 'back');
    await wait(650);
    setExit(true);
    await wait(620);
    // a view transition snapshots the whole screen and freezes it until the next page has rendered: lovely on a laptop,
    // but on a phone that is a visible stall while the overview's charts mount
    const light = matchMedia('(max-width: 1023px), (pointer: coarse)').matches;
    navigate(from, { replace: true, viewTransition: !light });
  };

  // `busy` is raised before the session exists, so being signed in does not redirect away mid-animation
  const verify = async (input: VerifyInput): Promise<VerifyOutcome> => {
    setBusy('form');
    try {
      const result = await auth.verifyCode(input);
      if (result.status === 'signed_in') void finish(result.isNew);
      else setBusy(null);
      return result;
    } catch (e) {
      setBusy(null);
      throw e;
    }
  };

  const demo = async () => {
    setBusy('demo');
    try {
      await auth.startDemo();
    } catch (e) {
      setBusy(null);
      throw e;
    }
    void finish(true);
  };

  const switchMode = (m: Mode) => navigate(m === 'register' ? '/register' : '/login', { replace: true, state: location.state });

  return (
    <div ref={root} className="auth-root" data-exit={exit}>
      <AuroraBackdrop />
      <div className="auth-grid">
        <section className="auth-hero" aria-label="About Spendly">
          <Logo />
          <div className="space-y-5 pt-[clamp(4px,2vh,24px)]">
            <p className="kicker">
              <span className="kicker-dot" /> Private · self-hostable · no bank passwords
            </p>
            <Headline />
          </div>
          <p className="hero-copy">Bring your bank, card and UPI spending into one private place — Zomato, Swiggy, Zepto, BookMyShow and everything else — and let a coach that only quotes your own numbers explain it.</p>
          <div className="relative min-h-0">
            <HeroStage />
          </div>
          <div className="space-y-2">
            <SampleNote />
            <Ribbon />
          </div>
        </section>

        <section className="auth-panel" aria-label={mode === 'register' ? 'Create an account' : 'Sign in'}>
          <div className="card-wrap">
            <AuthCard mode={mode} onMode={switchMode} busy={busy} welcome={welcome} delivery={config.data?.otp.delivery} onRequestCode={auth.requestCode} onVerify={verify} onDemo={demo} />
          </div>
        </section>
      </div>
    </div>
  );
}

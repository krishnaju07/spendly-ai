import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Download, FlaskConical, Lock, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { OTP_LENGTH, PHONE_COUNTRY_CODE, formatNational, maskPhone, nationalDigits, normalizePhone, type AuthConfigDto, type OtpRequestResultDto } from '@spendly/shared';
import { Segmented } from '@/components/common/segmented';
import { useCountdown, type Cooldown } from '@/hooks/use-countdown';
import { prefersReducedMotion } from '@/hooks/use-reduced-motion';
import { ApiRequestError } from '@/lib/api';
import { FloatField } from './fields';
import { OtpInput } from './otp-input';
import { TrackList } from './track-list';

export type Mode = 'login' | 'register';
type Step = 'phone' | 'track' | 'code' | 'name';
const STEP_ORDER: Record<Step, number> = { phone: 0, track: 1, code: 2, name: 3 };

export interface VerifyInput {
  phone: string;
  otp: string;
  name?: string;
  /** The apps allowed on the track step; recorded by the server once the code is right. */
  tracked?: string[];
}
export type VerifyOutcome = { status: 'needs_name' } | { status: 'signed_in'; isNew: boolean };
/** `false` until someone is in; then whether the number was new (“Welcome”) or known (“Welcome back”). */
export type Welcome = false | 'new' | 'back';

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  /** A sign-in or demo is running or finishing: everything is locked. */
  busy: 'form' | 'demo' | null;
  welcome: Welcome;
  delivery: AuthConfigDto['otp']['delivery'] | undefined;
  onRequestCode: (phone: string) => Promise<OtpRequestResultDto>;
  onVerify: (input: VerifyInput) => Promise<VerifyOutcome>;
  onDemo: () => Promise<void>;
}

interface Sent {
  phone: string;
  /** When the code went out, and how long to wait before asking for another. */
  sentAt: number;
  cooldown: Cooldown;
  /** Test mode only: the code the server showed instead of texting. */
  devCode?: string;
  /** The code is in the person's authenticator app (an owner, or a server with no texting). */
  viaApp?: boolean;
}

const PHONE_HINT = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9';
const fallbackMessage = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Restarts the shake on an element without remounting what is inside it. */
function shake(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

function Problem({ text, id }: { text: string; id?: string }) {
  return (
    <div id={id} role="alert" className="shake mt-4 flex items-start gap-2.5 rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {text}
    </div>
  );
}

/**
 * Sign in and sign up are the same three steps: your mobile number, the code texted to it, and — only
 * for a number Spendly has not seen — your name. The segmented switch just decides whether the name
 * is asked for up front. Creating an account adds one step before the code: which food and entertainment
 * apps Spendly may track, so the code that follows also confirms that choice.
 */
export function AuthCard({ mode, onMode, busy, welcome, delivery, onRequestCode, onVerify, onDemo }: Props) {
  const isRegister = mode === 'register';
  const card = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const otpWrap = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>('phone');
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [name, setName] = useState('');
  // what the number field shows: plain digits are spaced as they are typed, but anything with a `+` is left alone until it loses focus
  const [raw, setRaw] = useState('');
  const [otp, setOtp] = useState('');
  const [tracked, setTracked] = useState<string[]>([]);
  const [touched, setTouched] = useState({ name: false, phone: false });
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [otpState, setOtpState] = useState<'idle' | 'invalid'>('idle');

  const phone = normalizePhone(raw);
  const left = useCountdown(sent?.cooldown ?? null);
  const locked = busy !== null || sending;
  const done = welcome !== false;
  const phoneError = touched.phone && !phone ? PHONE_HINT : undefined;
  const nameError = touched.name && !name.trim() ? 'Enter your name' : undefined;
  const ctaState = done ? 'done' : sending || busy === 'form' ? 'busy' : 'idle';

  const go = (next: Step) => {
    setDir(STEP_ORDER[next] >= STEP_ORDER[step] ? 'fwd' : 'back');
    setStep(next);
    setProblem(null);
  };

  // every step starts with its field ready, a beat after the slide begins so the page does not jump
  useEffect(() => {
    const target = step === 'code' ? otpRef : step === 'name' ? nameRef : dir === 'back' ? phoneRef : null;
    const t = setTimeout(() => target?.current?.focus({ preventScroll: true }), 160);
    return () => clearTimeout(t);
  }, [step, dir]);

  // the card leans toward the pointer and a soft light follows it; still on touch screens
  useEffect(() => {
    const el = card.current;
    if (!el || prefersReducedMotion() || matchMedia('(pointer: coarse)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${(x - 0.5) * 4}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * 3}deg`);
      el.style.setProperty('--gx', `${x * 100}%`);
      el.style.setProperty('--gy', `${y * 100}%`);
    };
    const leave = () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);

  // with a mouse, start typing straight away once the card has settled (a phone keyboard should not pop up by itself)
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const t = setTimeout(() => document.getElementById(isRegister ? 'name' : 'phone')?.focus({ preventScroll: true }), 1100);
    return () => clearTimeout(t);
    // only on arrival: switching tabs afterwards must not steal focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (m: Mode) => {
    setProblem(null);
    setTouched({ name: false, phone: false });
    onMode(m);
  };

  const back = () => {
    setOtp('');
    setOtpState('idle');
    go('phone');
  };

  const submitPhone = (form: HTMLElement | null) => {
    // the name field only exists up front when creating an account; otherwise it is asked for later, untouched
    setTouched({ name: isRegister, phone: true });
    if (!phone || (isRegister && !name.trim())) return shake(form);
    if (delivery === 'unavailable') return;
    // a new account says what it may track before any code is sent; signing in goes straight to the code
    if (isRegister) return go('track');
    void sendCode(form);
  };

  const sendCode = async (form: HTMLElement | null) => {
    if (!phone || delivery === 'unavailable') return;
    // the code just sent to this very number is still fresh: go back to it rather than texting another
    if (sent && sent.phone === phone && Date.now() - sent.sentAt < sent.cooldown.seconds * 1000) {
      setOtp('');
      setOtpState('idle');
      return go('code');
    }
    setSending(true);
    setProblem(null);
    try {
      const r = await onRequestCode(phone);
      setSent({ phone, sentAt: Date.now(), cooldown: { seconds: r.resendInSeconds }, devCode: r.devCode, viaApp: r.viaApp });
      setOtp('');
      setOtpState('idle');
      go('code');
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'CODE_COOLDOWN') {
        // a code went out a moment ago (this page was reloaded, say): carry on to the code step and wait for the resend
        const wait = Number((e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 30);
        setSent({ phone, sentAt: Date.now(), cooldown: { seconds: wait } });
        setOtp('');
        setOtpState('idle');
        go('code');
      } else {
        setProblem(fallbackMessage(e, 'Could not send the code. Please try again.'));
        shake(form);
      }
    } finally {
      setSending(false);
    }
  };

  const resend = async () => {
    if (!sent || left > 0 || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const r = await onRequestCode(sent.phone);
      setSent({ phone: sent.phone, sentAt: Date.now(), cooldown: { seconds: r.resendInSeconds }, devCode: r.devCode, viaApp: r.viaApp });
      setOtp('');
      setOtpState('idle');
      otpRef.current?.focus({ preventScroll: true });
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'CODE_COOLDOWN') {
        const wait = Number((e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 30);
        setSent({ phone: sent.phone, sentAt: Date.now(), cooldown: { seconds: wait } });
      }
      setProblem(fallbackMessage(e, 'Could not send a new code. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  const verify = async (code: string, withName?: string) => {
    if (!sent || busy !== null) return;
    setProblem(null);
    try {
      const r = await onVerify({ phone: sent.phone, otp: code, name: withName ?? (isRegister && name.trim() ? name.trim() : undefined), tracked: isRegister && tracked.length ? tracked : undefined });
      if (r.status === 'needs_name') {
        setTouched((t) => ({ ...t, name: false }));
        go('name');
      }
    } catch (e) {
      const text = fallbackMessage(e, 'Could not check the code. Please try again.');
      const attemptsLeft = e instanceof ApiRequestError ? (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft : undefined;
      // this code can no longer work: let a new one be asked for straight away
      const spent = e instanceof ApiRequestError && (e.code === 'CODE_EXPIRED' || e.code === 'CODE_LOCKED' || attemptsLeft === 0);
      if (spent) setSent((s) => (s ? { ...s, sentAt: 0, cooldown: { seconds: 0 } } : s));
      if (step === 'name' && spent) go('code');
      setProblem(text);
      setOtpState('invalid');
      shake(otpWrap.current);
      // let the red boxes be seen, then clear them ready for another try
      setTimeout(() => {
        setOtp('');
        setOtpState('idle');
        otpRef.current?.focus({ preventScroll: true });
      }, 520);
    }
  };

  const runDemo = async () => {
    setProblem(null);
    try {
      await onDemo();
    } catch (e) {
      setProblem(fallbackMessage(e, 'Could not start the demo. Please try again.'));
    }
  };

  // nothing is texted: the owner types the code from an authenticator app
  const byApp = delivery === 'authenticator';
  // the code step too: an owner on a server that shows codes to everyone else still reads theirs from the app
  const appCode = byApp || sent?.viaApp === true;

  const title = step === 'track' ? 'Choose what to track' : step === 'code' ? 'Enter your code' : step === 'name' ? 'Nice to meet you' : isRegister ? 'Create your workspace' : 'Welcome back';
  const subtitle =
    step === 'track' ? (
      'Spendly only looks for spending from the apps you allow here.'
    ) : step === 'code' && appCode ? (
      <>
        Open your authenticator app and enter the {OTP_LENGTH}-digit code for <b className="tnum font-semibold text-foreground">{sent ? maskPhone(sent.phone) : ''}</b>.
      </>
    ) : step === 'code' ? (
      <>
        We sent a {OTP_LENGTH}-digit code to <b className="tnum font-semibold text-foreground">{sent ? maskPhone(sent.phone) : ''}</b>.
      </>
    ) : step === 'name' ? (
      'That number is new here. What should we call you?'
    ) : isRegister ? (
      'A minute, no card and no app passwords.'
    ) : (
      'Sign in with your mobile number — no password to remember.'
    );

  const cta = {
    phone: { idle: isRegister || byApp ? 'Continue' : 'Send code', busy: byApp ? 'One moment…' : 'Sending code…' },
    track: { idle: byApp ? 'Allow and continue' : 'Allow and send code', busy: byApp ? 'One moment…' : 'Sending code…' },
    code: { idle: 'Verify and continue', busy: 'Checking…' },
    name: { idle: 'Create account', busy: 'Creating your workspace…' },
  }[step];
  const phoneHint = byApp
    ? isRegister
      ? 'Next you choose which apps to track, then enter the code from your authenticator app.'
      : 'You will enter the code from your authenticator app.'
    : `${isRegister ? 'Next you choose which apps to track, then we text you a one-time code.' : 'We will text you a one-time code.'} Standard SMS rates from your operator may apply.`;
  const ctaBody =
    ctaState === 'done' ? (
      <>
        <Check className="pop-in size-5" strokeWidth={3} aria-hidden /> {welcome === 'back' ? 'Welcome back' : 'Welcome'}
      </>
    ) : ctaState === 'busy' ? (
      <>
        <span className="spinner" aria-hidden /> {cta.busy}
      </>
    ) : (
      <>
        {cta.idle} <ArrowRight className="arrow size-5" aria-hidden />
      </>
    );

  return (
    <div ref={card} className="auth-card">
      <div className="expand" data-open={step === 'phone'} inert={step !== 'phone'}>
        <div className="pb-6">
          <Segmented
            fill
            label="Sign in or create an account"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'login', label: 'Sign in' },
              { value: 'register', label: 'Create account' },
            ]}
          />
        </div>
      </div>
      <div className="expand" data-open={step !== 'phone'} inert={step === 'phone'}>
        <div className="pb-5">
          <button type="button" onClick={back} disabled={busy !== null} className="back">
            <ArrowLeft className="size-4" aria-hidden /> {step === 'track' ? 'Back' : 'Change number'}
          </button>
        </div>
      </div>

      <div key={step} className="step" data-dir={dir}>
        <h2 key={`${step}-${mode}`} className="swap type-title text-[27px] leading-tight">
          {title}
        </h2>
        <p key={`s-${step}-${mode}`} className="swap mt-1.5 text-sm text-muted-foreground">
          {subtitle}
        </p>

        {step === 'phone' && (
          <form
            noValidate
            className="mt-6"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              submitPhone(e.currentTarget);
            }}
          >
            <div className="expand" data-open={isRegister} inert={!isRegister}>
              <div className="pb-3">
                <FloatField
                  id="name"
                  label="Your name"
                  icon={UserRound}
                  autoComplete="name"
                  value={name}
                  disabled={locked}
                  error={nameError}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name && setTouched((t) => ({ ...t, name: true }))}
                />
              </div>
            </div>
            <FloatField
              ref={phoneRef}
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              label="Mobile number"
              icon={Smartphone}
              prefix={PHONE_COUNTRY_CODE}
              value={raw}
              disabled={locked}
              error={phoneError}
              onChange={(e) => {
                const typed = e.target.value.replace(/[^\d\s\-+().]/g, '');
                setRaw(typed.includes('+') ? typed.slice(0, 22) : formatNational(typed.replace(/\D/g, '').slice(0, 10)));
                setProblem(null);
              }}
              onPaste={(e) => {
                e.preventDefault();
                setRaw(formatNational(nationalDigits(e.clipboardData.getData('text'))));
                setProblem(null);
              }}
              onBlur={() => {
                if (!raw) return;
                setTouched((t) => ({ ...t, phone: true }));
                // "+91 98765-43210" tidies itself to "98765 43210"
                if (phone) setRaw(formatNational(phone.slice(PHONE_COUNTRY_CODE.length)));
              }}
            />
            {delivery === 'dev' && (
              <div className="note mt-3" data-tone="dev">
                <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <b>Test mode.</b> No text message is sent — your code appears on the next screen.
                </span>
              </div>
            )}
            {byApp && (
              <div className="note mt-3" data-tone="dev">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <b>No text message is sent.</b> Enter the number set up for this server, then the code from your authenticator app.
                </span>
              </div>
            )}
            {delivery === 'unavailable' && (
              <div className="note mt-3" data-tone="off" role="status">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>Texting sign-in codes is not set up on this server yet. You can still look around with the demo workspace below.</span>
              </div>
            )}
            {problem && <Problem text={problem} />}
            <button type="submit" className="cta mt-5" data-state={ctaState} disabled={locked || delivery === 'unavailable'}>
              {ctaBody}
            </button>
            <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{phoneHint}</p>
          </form>
        )}

        {step === 'track' && (
          <form
            noValidate
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tracked.length) return shake(e.currentTarget);
              void sendCode(e.currentTarget);
            }}
          >
            <TrackList value={tracked} onChange={setTracked} disabled={locked} />
            <div className="note mt-4" data-tone="info">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <b>What this allows.</b> Spendly recognises these apps in the statements, receipts and entries you add. It never signs in to them and never asks for their passwords. Change it any time in Settings.
              </span>
            </div>
            {problem && <Problem text={problem} />}
            <button type="submit" className="cta mt-5" data-state={ctaState} disabled={locked || tracked.length === 0}>
              {ctaBody}
            </button>
            <p className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[13px] text-muted-foreground">
              <span>{tracked.length ? (byApp ? 'The code from your app confirms this choice.' : 'The code we text confirms this choice.') : 'Pick at least one app to allow.'}</span>
              <button type="button" className="link" disabled={locked} onClick={() => {
                  setTracked([]);
                  void sendCode(null);
                }}>
                Skip for now
              </button>
            </p>
          </form>
        )}

        {step === 'code' && (
          <form
            noValidate
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (otp.length === OTP_LENGTH) void verify(otp);
              else shake(otpWrap.current);
            }}
          >
            <div ref={otpWrap}>
              <OtpInput
                ref={otpRef}
                value={otp}
                state={done ? 'ok' : otpState}
                disabled={busy !== null}
                describedBy={problem ? 'otp-problem' : undefined}
                onChange={(v) => {
                  setOtp(v);
                  if (problem) setProblem(null);
                  if (otpState !== 'idle') setOtpState('idle');
                }}
                onComplete={(v) => void verify(v)}
              />
            </div>
            {sent?.devCode && (
              <div className="dev-code">
                <span>
                  Test mode — your code is <b>{sent.devCode}</b>
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setOtp(sent.devCode as string);
                    void verify(sent.devCode as string);
                  }}
                >
                  Use it
                </button>
              </div>
            )}
            {problem && <Problem id="otp-problem" text={problem} />}
            <button type="submit" className="cta mt-5" data-state={ctaState} disabled={busy !== null || otp.length < OTP_LENGTH}>
              {ctaBody}
            </button>
            <p className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span>{appCode ? 'Code not accepted?' : 'Did not get it?'}</span>
              {left > 0 ? (
                <span className="tnum" aria-live="off">
                  {appCode ? 'Start over' : 'Send a new code'} in {clock(left)}
                </span>
              ) : (
                <button type="button" className="link" onClick={() => void resend()} disabled={sending || busy !== null}>
                  {sending ? (appCode ? 'One moment…' : 'Sending…') : appCode ? 'Start over' : 'Send a new code'}
                </button>
              )}
            </p>
          </form>
        )}

        {step === 'name' && (
          <form
            noValidate
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched((t) => ({ ...t, name: true }));
              if (!name.trim()) return shake(e.currentTarget);
              void verify(otp, name.trim());
            }}
          >
            <FloatField
              ref={nameRef}
              id="new-name"
              label="Your name"
              icon={UserRound}
              autoComplete="name"
              value={name}
              disabled={busy !== null}
              error={nameError}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name && setTouched((t) => ({ ...t, name: true }))}
            />
            {problem && <Problem text={problem} />}
            <button type="submit" className="cta mt-5" data-state={ctaState} disabled={busy !== null}>
              {ctaBody}
            </button>
          </form>
        )}
      </div>

      <div className="expand" data-open={step === 'phone'} inert={step !== 'phone'}>
        <div>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={() => void runDemo()}
            disabled={busy !== null || sending}
            className="group flex h-[52px] w-full items-center justify-between rounded-full border bg-transparent px-5 text-[15px] font-medium outline-none transition-[transform,background-color,border-color] hover:border-foreground/30 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
          >
            <span className="flex items-center gap-2.5">
              {busy === 'demo' ? <span className="spinner" aria-hidden /> : <FlaskConical className="size-[18px]" aria-hidden />}
              {busy === 'demo' ? 'Preparing the demo…' : 'Try the demo workspace'}
            </span>
            <ArrowRight className="size-[18px] transition-transform duration-300 ease-[var(--spring-bouncy)] group-hover:translate-x-1" aria-hidden />
          </button>
          <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">Sample data in a separate sandbox, clearly labelled. It never touches a real account and deletes itself after 24 hours.</p>
        </div>
      </div>

      <p className="trust mt-5">
        {[
          [ShieldCheck, 'No app passwords'],
          [Lock, 'Private by default'],
          [Download, 'Export anytime'],
        ].map(([Icon, text], i) => {
          const I = Icon as typeof Lock;
          return (
            <span key={text as string} className="pop-in" style={{ '--i': i + 8 } as React.CSSProperties}>
              <I className="size-3.5" aria-hidden /> {text as string}
            </span>
          );
        })}
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LinkCard, SERVICE_NAMES } from '@/components/common/link-card';
import { api } from '@/lib/api';
import { postLinkResult } from '@/lib/link-channel';

/**
 * The first step of linking, opened in a small window: it asks the server where the service's own sign-in page is and
 * goes there. It is a page of Spendly's (not the service's address straight away) so a browser lets the click open it.
 */
export default function LinkStart() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const provider = params.get('provider') ?? '';
  const name = SERVICE_NAMES[provider] ?? 'the service';
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; a sign-in must be started once
    if (started.current) return;
    started.current = true;
    api
      .post<{ url: string }>(`/integrations/providers/${provider}/connect`)
      .then(({ url }) => window.location.replace(url))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not start the sign-in.');
        postLinkResult({ provider, result: 'error' });
      });
  }, [provider]);

  const leave = () => {
    window.close();
    // a window the page did not open cannot close itself: carry on in this tab
    setTimeout(() => navigate('/settings?tab=tracking', { replace: true }), 150);
  };

  if (error) {
    return (
      <LinkCard title={`Could not open ${name}`} body={error}>
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-bad-soft px-3 py-2 text-left text-[13px] text-bad"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> Nothing was linked.</p>
        <Button className="mt-5" onClick={leave}>Back to Spendly</Button>
      </LinkCard>
    );
  }
  return <LinkCard busy title={`Opening ${name}…`} body={`You will sign in on ${name}’s own page. Spendly never sees your OTP or password.`} />;
}

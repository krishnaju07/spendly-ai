import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '@/lib/api';
import { postLinkResult, type LinkResult } from '@/lib/link-channel';
import { LinkCard, SERVICE_NAMES } from '@/components/common/link-card';

/**
 * Where the service sends the person back to. It hands the code it was given to the server, tells the page that asked
 * how it went, and closes its own window; if it was opened as a plain tab it carries on to Settings instead.
 */
export default function LinkCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<LinkResult | null>(null);
  const [provider, setProvider] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // the code is good for one use: never send it twice (StrictMode runs effects twice in development)
    if (started.current) return;
    started.current = true;
    void (async () => {
      const code = params.get('code');
      const state = params.get('state');
      let id = '';
      let outcome: LinkResult = 'error';
      if (params.get('error')) outcome = 'denied';
      else if (code && state) {
        try {
          id = (await api.post<{ provider: string }>('/integrations/providers/complete', { code, state })).provider;
          outcome = 'ok';
        } catch {
          outcome = 'error';
        }
      }
      setProvider(id);
      setResult(outcome);
      postLinkResult({ provider: id, result: outcome });
      window.close();
      // still here: this was a tab, not a window the page opened
      setTimeout(() => navigate(`/settings?tab=tracking&link=${id || 'none'}:${outcome}`, { replace: true }), 600);
    })();
  }, [params, navigate]);

  const name = SERVICE_NAMES[provider] ?? 'Your account';
  if (result === null) return <LinkCard busy title="Finishing up…" body="Just a moment." />;
  if (result === 'ok') return <LinkCard title={`${name} is linked`} body="You can close this window. Spendly is taking you back." />;
  if (result === 'denied') return <LinkCard title="Not linked" body="The sign-in was cancelled, so nothing was linked." />;
  return <LinkCard title="Could not link" body="Something went wrong finishing the sign-in. Please try again from Settings." />;
}

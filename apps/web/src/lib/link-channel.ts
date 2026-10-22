/**
 * Linking an account happens in a small window (the service's sign-in page opens there), and the page that asked has to
 * hear how it went. A BroadcastChannel reaches it even when the service's page severs `window.opener`, which several do.
 */
const NAME = 'spendly-link';

export type LinkResult = 'ok' | 'denied' | 'error';
export interface LinkMessage {
  provider: string;
  result: LinkResult;
}

export function postLinkResult(message: LinkMessage): void {
  try {
    const channel = new BroadcastChannel(NAME);
    channel.postMessage(message);
    channel.close();
  } catch {
    /* an old browser: the window falls back to carrying on in its own tab */
  }
}

/** Calls `fn` for every result any window reports; returns the way to stop listening. */
export function onLinkResult(fn: (message: LinkMessage) => void): () => void {
  try {
    const channel = new BroadcastChannel(NAME);
    channel.onmessage = (e: MessageEvent<LinkMessage>) => fn(e.data);
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}

const SIZE = { width: 520, height: 740 };

/** Opens the sign-in window for a service. Returns false when the browser blocked it, so the caller can use this tab instead. */
export function openLinkWindow(provider: string): boolean {
  const url = `/link?provider=${encodeURIComponent(provider)}`;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - SIZE.width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - SIZE.height) / 2));
  const w = window.open(url, 'spendly-link', `popup=yes,width=${SIZE.width},height=${SIZE.height},left=${left},top=${top}`);
  if (!w) return false;
  w.focus();
  return true;
}

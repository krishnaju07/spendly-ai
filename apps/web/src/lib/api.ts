import type { PageMeta } from '@spendly/shared';

/** A failed API call, with the stable error code the server sent and the request id for support. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
  /** Per-field messages from a validation error, keyed by field path. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};
const readCsrfCookie = () => /(?:^|; )csrf=([^;]+)/.exec(document.cookie)?.[1] ?? null;

const listeners = new Set<() => void>();
/** Called when the server says the session is gone, so the app can return to the sign-in screen. */
export const onUnauthorized = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

type Query = Record<string, string | number | boolean | null | undefined | readonly string[]>;

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? (v as readonly string[]).join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

interface Options {
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

async function send(method: string, path: string, opts: Options = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Spendly-Client': 'web' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken ?? readCsrfCookie() ?? '';
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(`/api/v1${path}${qs(opts.query)}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK', 'You appear to be offline or the server cannot be reached.');
  }
}

async function failure(res: Response): Promise<ApiRequestError> {
  let payload: { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } = {};
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const e = payload.error;
  const err = new ApiRequestError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  if (res.status === 401) listeners.forEach((fn) => fn());
  return err;
}

async function json<T>(method: string, path: string, opts?: Options): Promise<T> {
  const res = await send(method, path, opts);
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as { data: T }).data;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => json<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: Query) => json<T>('POST', path, { body: body ?? {}, query }),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => json<T>('PATCH', path, { body: body ?? {} }),
  delete: <T>(path: string, body?: unknown) => json<T>('DELETE', path, body === undefined ? {} : { body }),
  upload: <T>(path: string, form: FormData) => json<T>('POST', path, { form }),
  /** Fetches a file and saves it through the browser (CSV, PDF, JSON exports). */
  async download(path: string, query?: Query, fallbackName = 'download') {
    const res = await send('GET', path, { query });
    if (!res.ok) throw await failure(res);
    const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

export type { PageMeta };
export const apiUrl = (path: string, query?: Query) => `/api/v1${path}${qs(query)}`;

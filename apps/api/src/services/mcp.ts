import { createHash, randomBytes } from 'node:crypto';
import { AppError, tooMany } from '../lib/errors';

/**
 * Just enough of OAuth 2.1 (authorization code + PKCE, dynamic client registration) and MCP (JSON-RPC over HTTP) to
 * read from a service's official MCP server as the person who signed in to it. The person signs in — phone number and
 * OTP — on the service's own page; Spendly only ever receives the token that page issues.
 */

const TIMEOUT_MS = 15_000;
const PROTOCOL_VERSION = '2025-06-18';

/** The service's endpoints must be https; plain http is accepted only for a machine on this computer (development, test doubles). */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(502, 'PROVIDER_ERROR', 'The service gave an address Spendly cannot use.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new AppError(502, 'PROVIDER_ERROR', 'The service gave an address that is not secure, so Spendly will not use it.');
  }
  return url;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  assertSafeUrl(url);
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError(502, 'PROVIDER_UNREACHABLE', 'Could not reach the service. Check your connection and try again.');
  }
}

// ── OAuth ──────────────────────────────────────────────────────────────────────────────────────

export interface OAuthEndpoints {
  authorization: string;
  token: string;
  registration: string | null;
}

/** RFC 8414 discovery, falling back to the paths the service documents. */
export async function discover(base: string, fallback: { authorization: string; token: string; registration: string | null }): Promise<OAuthEndpoints> {
  try {
    const res = await request(new URL('/.well-known/oauth-authorization-server', base).toString(), { headers: { accept: 'application/json' } });
    if (res.ok) {
      const m = (await res.json()) as Record<string, unknown>;
      if (typeof m.authorization_endpoint === 'string' && typeof m.token_endpoint === 'string') {
        assertSafeUrl(m.authorization_endpoint);
        assertSafeUrl(m.token_endpoint);
        const reg = typeof m.registration_endpoint === 'string' ? assertSafeUrl(m.registration_endpoint).toString() : null;
        return { authorization: m.authorization_endpoint, token: m.token_endpoint, registration: reg };
      }
    }
  } catch (error) {
    if (error instanceof AppError && error.code !== 'PROVIDER_UNREACHABLE') throw error;
  }
  return fallback;
}

/**
 * Where a resource server (the MCP endpoint) says its sign-in lives (RFC 9728), then that server's own endpoints. Some
 * services (Zepto) keep sign-in on a separate host; others answer for both on one.
 */
export async function discoverViaResource(resource: string, fallback: OAuthEndpoints): Promise<OAuthEndpoints> {
  try {
    const res = await request(new URL('/.well-known/oauth-protected-resource', resource).toString(), { headers: { accept: 'application/json' } });
    if (res.ok) {
      const meta = (await res.json()) as { authorization_servers?: unknown };
      const server = Array.isArray(meta.authorization_servers) ? meta.authorization_servers.find((s): s is string => typeof s === 'string') : undefined;
      if (server) return await discover(assertSafeUrl(server).origin, fallback);
    }
  } catch (error) {
    if (error instanceof AppError && error.code !== 'PROVIDER_UNREACHABLE') throw error;
  }
  return discover(resource, fallback);
}

/** RFC 7591: the service hands out a client id for Spendly's redirect address, so nothing has to be configured by hand. */
export async function registerClient(endpoint: string, redirectUri: string): Promise<string> {
  const res = await request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Spendly',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: unknown };
  if (!res.ok || typeof body.client_id !== 'string') {
    throw new AppError(502, 'PROVIDER_REJECTED', 'The service would not accept Spendly as an app. For a hosted Spendly it has to approve it first.');
  }
  return body.client_id;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizeUrl(endpoint: string, p: { clientId: string; redirectUri: string; challenge: string; state: string; scope: string }): string {
  const url = assertSafeUrl(endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    scope: p.scope,
  }).toString();
  return url.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

/** The token endpoint refused: the sign-in has to be done again. */
export class SignInExpired extends Error {}

/** How a service wants token requests: Swiggy takes JSON, standard OAuth servers take a form. */
export type TokenFormat = 'json' | 'form';

async function tokenCall(endpoint: string, body: Record<string, string>, format: TokenFormat): Promise<Tokens> {
  const res = await request(endpoint, {
    method: 'POST',
    headers: { 'content-type': format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: format === 'json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown };
  if (res.status === 400 || res.status === 401) throw new SignInExpired(typeof json.error === 'string' ? json.error : 'invalid_grant');
  if (!res.ok || typeof json.access_token !== 'string') throw new AppError(502, 'PROVIDER_ERROR', 'The service could not complete the sign-in. Please try again.');
  const seconds = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
  return { accessToken: json.access_token, refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null, expiresAt: new Date(Date.now() + seconds * 1000) };
}

export const exchangeCode = (endpoint: string, p: { clientId: string; code: string; verifier: string; redirectUri: string; format: TokenFormat }) =>
  tokenCall(endpoint, { grant_type: 'authorization_code', client_id: p.clientId, code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri }, p.format);

export const refreshTokens = (endpoint: string, p: { clientId: string; refreshToken: string; format: TokenFormat }) =>
  tokenCall(endpoint, { grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken }, p.format);

// ── MCP ────────────────────────────────────────────────────────────────────────────────────────

/** Reads the first JSON-RPC message with this id out of either a plain JSON body or a server-sent-events stream. */
function messageFrom(text: string, contentType: string, id: number): { result?: unknown; error?: { message?: unknown } } | null {
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data) as { id?: unknown; result?: unknown; error?: { message?: unknown } };
        if (msg.id === id) return msg;
      } catch {
        /* a keep-alive or a partial line */
      }
    }
    return null;
  }
  try {
    const msg = JSON.parse(text) as { id?: unknown; result?: unknown; error?: { message?: unknown } };
    return msg.id === id || msg.id === undefined ? msg : null;
  } catch {
    return null;
  }
}

export interface ToolResult {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
}

/**
 * One session with one MCP server. It can only call the tools it was constructed with: the token the person grants is
 * wide (the same server can place orders), so reading is enforced here, in code, not by trusting each caller.
 */
export class McpClient {
  private session: string | null = null;
  private seq = 0;
  private ready = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly allowed: ReadonlySet<string>,
  ) {}

  private async send(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = notification ? undefined : ++this.seq;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`,
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    if (this.ready) headers['mcp-protocol-version'] = PROTOCOL_VERSION;
    const res = await request(this.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params }) });
    if (res.status === 401) throw new SignInExpired('unauthorized');
    if (res.status === 429) throw tooMany('The service asked Spendly to slow down. Try again in a minute.');
    if (!res.ok) throw new AppError(502, 'PROVIDER_ERROR', `The service answered with an error (${res.status}).`);
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    if (notification) return null;
    const msg = messageFrom(await res.text(), res.headers.get('content-type') ?? '', id as number);
    if (!msg) throw new AppError(502, 'PROVIDER_FORMAT', 'The service answered in a way Spendly does not understand.');
    if (msg.error) throw new AppError(502, 'PROVIDER_ERROR', typeof msg.error.message === 'string' ? msg.error.message.slice(0, 200) : 'The service reported an error.');
    return msg.result;
  }

  async open(): Promise<void> {
    await this.send('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Spendly', version: '1.0.0' } });
    this.ready = true;
    await this.send('notifications/initialized', {}, true);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!this.allowed.has(name)) throw new Error(`Refusing to call "${name}": Spendly only reads order history.`);
    if (!this.ready) await this.open();
    const result = (await this.send('tools/call', { name, arguments: args })) as ToolResult;
    if (result?.isError) throw new AppError(502, 'PROVIDER_ERROR', (result.content?.map((c) => c.text).filter(Boolean).join(' ') || 'The service could not do that.').slice(0, 200));
    return result;
  }
}

/** A tool's answer as data: structured content if there is any, otherwise its text, parsed as JSON when it is JSON. */
export function payloadOf(result: ToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = (result.content ?? []).map((c) => c.text ?? '').filter(Boolean).join('\n').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

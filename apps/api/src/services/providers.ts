import { PROVIDER_IDS, type ProviderConnectionDto, type ProviderId, type ProviderSyncResultDto } from '@spendly/shared';
import { env } from '../config/env';
import { randomToken, seal, sha256, unseal } from '../lib/crypto';
import { AppError, badRequest, conflict, tooMany } from '../lib/errors';
import type { AuthContext } from '../middleware/context';
import { ProviderConnection, ProviderFlow, type ProviderConnectionDoc } from '../models/account';
import { Transaction } from '../models/finance';
import { authorizeUrl, discover, discoverViaResource, exchangeCode, pkcePair, refreshTokens, registerClient, SignInExpired, type TokenFormat } from './mcp';
import type { ProviderOrder } from './order-parse';
import { readSwiggyOrders } from './swiggy';
import { createTransaction } from './transactions';
import { readZeptoOrders } from './zepto';
import { readZomatoOrders } from './zomato';

interface OAuthSetup {
  authorization: string;
  token: string;
  clientId: string;
  scope: string;
}

interface ProviderDef {
  id: ProviderId;
  name: string;
  access: 'available' | 'blocked';
  note: string;
  limits: string;
  /** Tracked apps this link reads; at least one has to be ticked before it can be linked. */
  platforms: string[];
  /** Not yet seen working on a real account, so the first sync shows what it found and waits for a yes. */
  review: boolean;
  tokenFormat: TokenFormat;
  /** Finds the service's sign-in and registers Spendly there. */
  oauth: (redirectUri: string) => Promise<OAuthSetup>;
  /** `stored` holds the references of orders already saved, so a service that needs a second call per order can skip those. */
  read: (ctx: { token: string; tracked: ReadonlySet<string>; stored: ReadonlySet<string> }) => Promise<{ orders: ProviderOrder[]; scanned: number; notes: string[] }>;
}

const SWIGGY_BASE = (env.SWIGGY_MCP_URL ?? 'https://mcp.swiggy.com').replace(/\/+$/, '');
const ZEPTO_BASE = (env.ZEPTO_MCP_URL ?? 'https://mcp.zepto.co.in').replace(/\/+$/, '');
const ZOMATO_BASE = (env.ZOMATO_MCP_URL ?? 'https://mcp-server.zomato.com').replace(/\/+$/, '');
const ZEPTO_AUTH = ZEPTO_BASE === 'https://mcp.zepto.co.in' ? 'https://auth.zepto.co.in' : ZEPTO_BASE;

// one client id per sign-in service and redirect address, so connecting twice does not register Spendly twice
const clients = new Map<string, string>();

async function register(registration: string | null, redirectUri: string, name: string): Promise<string> {
  if (!registration) throw new AppError(502, 'PROVIDER_ERROR', `${name} did not say how an app signs up, so it cannot be linked.`);
  const key = `${registration}|${redirectUri}`;
  let clientId = clients.get(key);
  if (!clientId) {
    clientId = await registerClient(registration, redirectUri);
    clients.set(key, clientId);
  }
  return clientId;
}

const DEFS: Record<ProviderId, ProviderDef> = {
  swiggy: {
    id: 'swiggy',
    name: 'Swiggy',
    access: 'available',
    note: 'You sign in with your phone number and the OTP Swiggy texts you, on Swiggy’s own page (it opens in a small window and closes by itself). Spendly never sees the OTP or a password, and only reads your order history.',
    limits: 'Swiggy shares your latest Food orders (up to 15) and your Instamart orders from the last 15 days. Spendly keeps what it reads, so your history builds up each time you sync.',
    platforms: ['swiggy', 'swiggy-instamart'],
    review: false,
    tokenFormat: 'json',
    oauth: async (redirectUri) => {
      const ep = await discover(SWIGGY_BASE, { authorization: `${SWIGGY_BASE}/auth/authorize`, token: `${SWIGGY_BASE}/auth/token`, registration: `${SWIGGY_BASE}/auth/register` });
      return { authorization: ep.authorization, token: ep.token, clientId: await register(ep.registration, redirectUri, 'Swiggy'), scope: 'mcp:tools' };
    },
    read: ({ token, tracked }) => readSwiggyOrders(token, SWIGGY_BASE, { food: tracked.has('swiggy'), instamart: tracked.has('swiggy-instamart') }),
  },
  zepto: {
    id: 'zepto',
    name: 'Zepto',
    access: 'available',
    note: 'You sign in with your phone number and the OTP Zepto texts you, on Zepto’s own page (it opens in a small window and closes by itself). Spendly asks for Zepto’s read-only permission and only reads your order history.',
    limits: 'Zepto shares your latest orders (up to 20). This link is new, so the first sync shows what Zepto sent and waits for you to confirm before anything is saved. Zepto lets only a short list of return addresses sign in: Spendly on your own computer works; one on a public address needs Zepto’s approval first.',
    platforms: ['zepto'],
    review: true,
    tokenFormat: 'form',
    oauth: async (redirectUri) => {
      const ep = await discoverViaResource(ZEPTO_BASE, { authorization: `${ZEPTO_AUTH}/authorize`, token: `${ZEPTO_AUTH}/token`, registration: `${ZEPTO_AUTH}/register` });
      return { authorization: ep.authorization, token: ep.token, clientId: await register(ep.registration, redirectUri, 'Zepto'), scope: 'tools:read' };
    },
    read: ({ token, stored }) => readZeptoOrders(token, ZEPTO_BASE, stored),
  },
  zomato: {
    id: 'zomato',
    name: 'Zomato',
    access: 'available',
    note: 'You sign in with your phone number on Zomato’s own page (it opens in a small window and closes by itself). Spendly asks for Zomato’s permission and only reads your order history.',
    limits: 'Zomato shares your order history, newest first: the first sync reads up to your latest 200 orders, then each sync adds what is new. Zomato says its sign-in is for personal-use apps and only from return addresses it has approved: Spendly on your own computer signed in fine when tried; if Zomato refuses yours, the steps to ask it are under “Other apps → Zomato”. The first sync shows what Zomato sent and waits for you to confirm before anything is saved.',
    platforms: ['zomato'],
    review: true,
    tokenFormat: 'form',
    oauth: async (redirectUri) => {
      const ep = await discover(ZOMATO_BASE, { authorization: `${ZOMATO_BASE}/authorize`, token: `${ZOMATO_BASE}/token`, registration: `${ZOMATO_BASE}/register` });
      return { authorization: ep.authorization, token: ep.token, clientId: await register(ep.registration, redirectUri, 'Zomato'), scope: 'mcp:tools' };
    },
    read: ({ token, stored }) => readZomatoOrders(token, ZOMATO_BASE, stored),
  },
};

const trackedBy = (auth: Pick<AuthContext, 'prefs'>) => new Set(auth.prefs.tracking?.platforms ?? []);

export async function listProviders(auth: Pick<AuthContext, 'userId'>): Promise<ProviderConnectionDto[]> {
  const conns = await ProviderConnection.find({ userId: auth.userId }).lean();
  return PROVIDER_IDS.map((id) => {
    const def = DEFS[id];
    const c = conns.find((x) => x.provider === id);
    return {
      id,
      name: def.name,
      access: def.access,
      note: def.note,
      review: def.review,
      returnAddress: redirectUriFor(),
      limits: def.limits,
      platforms: def.platforms,
      connected: Boolean(c),
      connectedAt: c?.connectedAt.toISOString() ?? null,
      lastSyncAt: c?.lastSyncAt?.toISOString() ?? null,
      lastSyncAdded: c?.lastSyncAdded ?? null,
      lastError: c?.lastError ?? null,
    };
  });
}

const available = (id: ProviderId): ProviderDef => {
  const def = DEFS[id];
  if (def.access === 'blocked') throw conflict(def.note, undefined, 'PROVIDER_BLOCKED');
  return def;
};

/** Where the service sends the person back to: a page of Spendly's own. Built from APP_ORIGIN, never from the request, so a forged Host header cannot change it. */
export const redirectUriFor = (): string => new URL('/callback', env.APP_ORIGIN).toString();

/** The address of the service's own sign-in page, where the person enters their phone number and OTP. */
export async function startConnect(auth: AuthContext, id: ProviderId): Promise<string> {
  const def = available(id);
  if (!def.platforms.some((p) => trackedBy(auth).has(p))) {
    throw conflict(`Tick ${def.name} in your tracked apps first, so Spendly knows it may read it.`, undefined, 'TRACK_FIRST');
  }
  const redirectUri = redirectUriFor();
  const setup = await def.oauth(redirectUri);
  const { verifier, challenge } = pkcePair();
  const state = randomToken(24);
  await ProviderFlow.create({ stateHash: sha256(state), userId: auth.userId, provider: id, clientId: setup.clientId, codeVerifierSealed: seal(verifier), redirectUri, tokenEndpoint: setup.token });
  return authorizeUrl(setup.authorization, { clientId: setup.clientId, redirectUri, challenge, state, scope: setup.scope });
}

/** The person came back from the service's page with a code: turn it into tokens and keep them, sealed. Says which service it was. */
export async function finishConnect(auth: AuthContext, q: { code: string; state: string }): Promise<ProviderId> {
  // a flow can be used once, and only by the person who started it
  const flow = await ProviderFlow.findOneAndDelete({ stateHash: sha256(q.state), userId: auth.userId });
  const verifier = flow ? unseal(flow.codeVerifierSealed) : null;
  if (!flow || !verifier) throw badRequest('This sign-in has expired. Start again from Settings.', undefined, 'FLOW_EXPIRED');
  const id = flow.provider as ProviderId;
  const def = available(id);
  let tokens;
  try {
    tokens = await exchangeCode(flow.tokenEndpoint, { clientId: flow.clientId, code: q.code, verifier, redirectUri: flow.redirectUri, format: def.tokenFormat });
  } catch (error) {
    if (error instanceof SignInExpired) throw badRequest('The service did not accept that sign-in. Please try again.', undefined, 'FLOW_REJECTED');
    throw error;
  }
  await ProviderConnection.findOneAndUpdate(
    { userId: auth.userId, provider: id },
    {
      $set: {
        clientId: flow.clientId,
        tokenEndpoint: flow.tokenEndpoint,
        accessTokenSealed: seal(tokens.accessToken),
        refreshTokenSealed: tokens.refreshToken ? seal(tokens.refreshToken) : null,
        accessExpiresAt: tokens.expiresAt,
        connectedAt: new Date(),
        lastError: null,
      },
    },
    { upsert: true },
  );
  return id;
}

export async function disconnect(auth: Pick<AuthContext, 'userId'>, id: ProviderId): Promise<void> {
  // the service documents no way to revoke a token, so it is forgotten here and lapses on its own
  await ProviderConnection.deleteOne({ userId: auth.userId, provider: id });
}

const recordError = (conn: ProviderConnectionDoc, lastError: string) => ProviderConnection.updateOne({ _id: conn._id }, { $set: { lastError } });

/** A token that is good for the next minute, refreshing (and rotating) it first when it is not — or when `force` says the service refused it. */
async function accessTokenFor(conn: ProviderConnectionDoc, def: ProviderDef, force = false): Promise<string> {
  const name = def.name;
  const current = unseal(conn.accessTokenSealed);
  if (!force && current && conn.accessExpiresAt.getTime() - Date.now() > 60_000) return current;
  const refresh = conn.refreshTokenSealed ? unseal(conn.refreshTokenSealed) : null;
  if (!refresh) {
    await recordError(conn, 'reconnect');
    throw conflict(`${name} needs you to sign in again.`, undefined, 'RECONNECT_REQUIRED');
  }
  try {
    const t = await refreshTokens(conn.tokenEndpoint, { clientId: conn.clientId, refreshToken: refresh, format: def.tokenFormat });
    await ProviderConnection.updateOne(
      { _id: conn._id },
      { $set: { accessTokenSealed: seal(t.accessToken), refreshTokenSealed: t.refreshToken ? seal(t.refreshToken) : conn.refreshTokenSealed, accessExpiresAt: t.expiresAt, lastError: null } },
    );
    return t.accessToken;
  } catch (error) {
    if (error instanceof SignInExpired) {
      await recordError(conn, 'reconnect');
      throw conflict(`${name} needs you to sign in again.`, undefined, 'RECONNECT_REQUIRED');
    }
    throw error;
  }
}

const syncing = new Set<string>();
const COOLDOWN_MS = 30_000;

/** `preview` only looks: it reads the service and says what it would add, and saves nothing. */
export async function syncProvider(auth: AuthContext, id: ProviderId, opts: { preview?: boolean } = {}): Promise<ProviderSyncResultDto> {
  const def = available(id);
  const key = `${auth.userId.toString()}:${id}`;
  if (syncing.has(key)) throw conflict('A sync is already running.', undefined, 'SYNC_RUNNING');
  const conn = await ProviderConnection.findOne({ userId: auth.userId, provider: id }).lean();
  if (!conn) throw conflict(`${def.name} is not linked yet.`, undefined, 'NOT_CONNECTED');
  if (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < COOLDOWN_MS) throw tooMany('Synced a moment ago. Give it half a minute.');

  const tracked = trackedBy(auth);
  if (!def.platforms.some((p) => tracked.has(p))) throw conflict(`Tick ${def.name} in your tracked apps first.`, undefined, 'TRACK_FIRST');

  syncing.add(key);
  try {
    // orders saved with their details: a reader skips these (and stops paging at a page made only of them). Ones saved before details
    // were kept are read again so they can be filled in.
    const stored = new Set((await Transaction.find({ userId: auth.userId, importSource: 'integration', orderDetail: { $ne: null } }).select('externalRef').lean()).map((t) => t.externalRef).filter((r): r is string => Boolean(r)));
    let read;
    try {
      read = await def.read({ token: await accessTokenFor(conn, def), tracked, stored });
    } catch (error) {
      if (!(error instanceof SignInExpired)) throw error;
      // the service refused a token that had not run out here (it was revoked, or its clock differs): refresh once, then ask again
      const latest = (await ProviderConnection.findById(conn._id).lean()) ?? conn;
      read = await def.read({ token: await accessTokenFor(latest, def, true), tracked, stored });
    }
    if (opts.preview) {
      const stored = new Set((await Transaction.find({ userId: auth.userId, externalRef: { $in: read.orders.map((o) => o.ref) } }).select('externalRef').lean()).map((t) => t.externalRef));
      const fresh = read.orders.filter((o) => !stored.has(o.ref) && o.status !== 'cancelled');
      return {
        preview: fresh.map((o) => ({ merchantName: o.merchantName, description: o.description, date: o.date.toISOString(), amountPaise: o.amountPaise, status: o.status })),
        added: 0,
        updated: 0,
        skipped: read.orders.length - fresh.length,
        scanned: read.scanned,
        notes: read.notes,
      };
    }
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const o of read.orders) {
      const existing = await Transaction.findOne({ userId: auth.userId, externalRef: o.ref }).select('status orderDetail').lean();
      const status = o.status === 'cancelled' ? 'failed' : o.status;
      if (existing) {
        // an order read while on its way is completed (or cancelled) the next time round; one saved before details were kept gets them now
        const set: Record<string, unknown> = {};
        if (existing.status !== status && existing.status === 'pending') set.status = status;
        if (!existing.orderDetail && o.detail) set.orderDetail = o.detail;
        if (Object.keys(set).length) {
          await Transaction.updateOne({ _id: existing._id }, { $set: set });
          updated++;
        } else skipped++;
        continue;
      }
      if (o.status === 'cancelled') {
        skipped++;
        continue;
      }
      await createTransaction(
        auth,
        { merchantName: o.merchantName, amountPaise: o.amountPaise, date: o.date.toISOString(), hasTime: true, type: 'expense', status, paymentMethod: 'other', description: o.description, notes: '', tags: [], externalRef: o.ref },
        { importSource: 'integration', orderDetail: o.detail ?? null },
      );
      added++;
    }
    await ProviderConnection.updateOne({ _id: conn._id }, { $set: { lastSyncAt: new Date(), lastSyncAdded: added, lastError: null } });
    return { added, updated, skipped, scanned: read.scanned, notes: read.notes };
  } catch (error) {
    if (error instanceof SignInExpired) {
      await ProviderConnection.updateOne({ _id: conn._id }, { $set: { lastError: 'reconnect' } });
      throw conflict(`${def.name} needs you to sign in again.`, undefined, 'RECONNECT_REQUIRED');
    }
    if (error instanceof AppError && error.code !== 'RECONNECT_REQUIRED') await ProviderConnection.updateOne({ _id: conn._id }, { $set: { lastError: error.message.slice(0, 200) } });
    throw error;
  } finally {
    syncing.delete(key);
  }
}

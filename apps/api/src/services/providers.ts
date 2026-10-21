import { PROVIDER_IDS, type ProviderConnectionDto, type ProviderId, type ProviderSyncResultDto } from '@spendly/shared';
import { env } from '../config/env';
import { randomToken, seal, sha256, unseal } from '../lib/crypto';
import { AppError, badRequest, conflict, tooMany } from '../lib/errors';
import type { AuthContext } from '../middleware/context';
import { ProviderConnection, ProviderFlow, type ProviderConnectionDoc } from '../models/account';
import { Transaction } from '../models/finance';
import { authorizeUrl, discover, exchangeCode, pkcePair, refreshTokens, registerClient, SignInExpired } from './mcp';
import { readSwiggyOrders } from './swiggy';
import { createTransaction } from './transactions';

interface ProviderDef {
  id: ProviderId;
  /** The service's MCP host; its OAuth endpoints are found from here. */
  base: string;
  name: string;
  access: 'available' | 'blocked';
  note: string;
  limits: string;
  platforms: string[];
}

const SWIGGY_BASE = (env.SWIGGY_MCP_URL ?? 'https://mcp.swiggy.com').replace(/\/+$/, '');

const DEFS: Record<ProviderId, ProviderDef> = {
  swiggy: {
    id: 'swiggy',
    base: SWIGGY_BASE,
    name: 'Swiggy',
    access: 'available',
    note: 'You sign in on Swiggy’s own page with your phone number and the OTP Swiggy texts you. Spendly never sees the OTP or a password, and only reads your order history.',
    limits: 'Swiggy shares your latest Food orders (up to 15) and your Instamart orders from the last 15 days. Spendly keeps what it reads, so your history builds up each time you sync.',
    platforms: ['swiggy', 'swiggy-instamart'],
  },
  zomato: {
    id: 'zomato',
    base: 'https://mcp-server.zomato.com',
    name: 'Zomato',
    access: 'blocked',
    note: 'Zomato has not opened its sign-in to apps like Spendly yet: its MCP server only allows a short list of AI apps and says it is not allowing third-party apps for now. Until Zomato agrees, Zomato spending comes from statements, receipts and entries you add.',
    limits: 'Not available yet.',
    platforms: ['zomato'],
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

// one client id per redirect address, so connecting twice does not register Spendly twice
const clients = new Map<string, string>();

/** Where the service sends the person back to. Built from APP_ORIGIN, never from the request, so a forged Host header cannot change it. */
export const redirectUriFor = (id: ProviderId): string => new URL(`/api/v1/integrations/providers/${id}/callback`, env.APP_ORIGIN).toString();

/** The address of the service's own sign-in page, where the person enters their phone number and OTP. */
export async function startConnect(auth: AuthContext, id: ProviderId): Promise<string> {
  const def = available(id);
  if (!def.platforms.some((p) => trackedBy(auth).has(p))) {
    throw conflict(`Tick ${def.name} in your tracked apps first, so Spendly knows it may read it.`, undefined, 'TRACK_FIRST');
  }
  const redirectUri = redirectUriFor(id);
  const endpoints = await discover(def.base, { authorization: `${def.base}/auth/authorize`, token: `${def.base}/auth/token`, registration: `${def.base}/auth/register` });
  if (!endpoints.registration) throw new AppError(502, 'PROVIDER_ERROR', `${def.name} did not say how an app signs up, so it cannot be linked.`);
  const cacheKey = `${endpoints.registration}|${redirectUri}`;
  let clientId = clients.get(cacheKey);
  if (!clientId) {
    clientId = await registerClient(endpoints.registration, redirectUri);
    clients.set(cacheKey, clientId);
  }
  const { verifier, challenge } = pkcePair();
  const state = randomToken(24);
  await ProviderFlow.create({ stateHash: sha256(state), userId: auth.userId, provider: id, clientId, codeVerifierSealed: seal(verifier), redirectUri, tokenEndpoint: endpoints.token });
  return authorizeUrl(endpoints.authorization, { clientId, redirectUri, challenge, state, scope: 'mcp:tools' });
}

/** The person came back from the service's page with a code: turn it into tokens and keep them, sealed. */
export async function finishConnect(auth: AuthContext, id: ProviderId, q: { code: string; state: string }): Promise<void> {
  available(id);
  // a flow can be used once, and only by the person who started it
  const flow = await ProviderFlow.findOneAndDelete({ stateHash: sha256(q.state), userId: auth.userId, provider: id });
  const verifier = flow ? unseal(flow.codeVerifierSealed) : null;
  if (!flow || !verifier) throw badRequest('This sign-in has expired. Start again from Settings.', undefined, 'FLOW_EXPIRED');
  let tokens;
  try {
    tokens = await exchangeCode(flow.tokenEndpoint, { clientId: flow.clientId, code: q.code, verifier, redirectUri: flow.redirectUri });
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
}

export async function disconnect(auth: Pick<AuthContext, 'userId'>, id: ProviderId): Promise<void> {
  // the service documents no way to revoke a token, so it is forgotten here and lapses on its own
  await ProviderConnection.deleteOne({ userId: auth.userId, provider: id });
}

const recordError = (conn: ProviderConnectionDoc, lastError: string) => ProviderConnection.updateOne({ _id: conn._id }, { $set: { lastError } });

/** A token that is good for the next minute, refreshing (and rotating) it first when it is not — or when `force` says the service refused it. */
async function accessTokenFor(conn: ProviderConnectionDoc, name: string, force = false): Promise<string> {
  const current = unseal(conn.accessTokenSealed);
  if (!force && current && conn.accessExpiresAt.getTime() - Date.now() > 60_000) return current;
  const refresh = conn.refreshTokenSealed ? unseal(conn.refreshTokenSealed) : null;
  if (!refresh) {
    await recordError(conn, 'reconnect');
    throw conflict(`${name} needs you to sign in again.`, undefined, 'RECONNECT_REQUIRED');
  }
  try {
    const t = await refreshTokens(conn.tokenEndpoint, { clientId: conn.clientId, refreshToken: refresh });
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

export async function syncProvider(auth: AuthContext, id: ProviderId): Promise<ProviderSyncResultDto> {
  const def = available(id);
  const key = `${auth.userId.toString()}:${id}`;
  if (syncing.has(key)) throw conflict('A sync is already running.', undefined, 'SYNC_RUNNING');
  const conn = await ProviderConnection.findOne({ userId: auth.userId, provider: id }).lean();
  if (!conn) throw conflict(`${def.name} is not linked yet.`, undefined, 'NOT_CONNECTED');
  if (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < COOLDOWN_MS) throw tooMany('Synced a moment ago. Give it half a minute.');

  const tracked = trackedBy(auth);
  const want = { food: tracked.has('swiggy'), instamart: tracked.has('swiggy-instamart') };
  if (!want.food && !want.instamart) throw conflict(`Tick ${def.name} in your tracked apps first.`, undefined, 'TRACK_FIRST');

  syncing.add(key);
  try {
    let read;
    try {
      read = await readSwiggyOrders(await accessTokenFor(conn, def.name), def.base, want);
    } catch (error) {
      if (!(error instanceof SignInExpired)) throw error;
      // the service refused a token that had not run out here (it was revoked, or its clock differs): refresh once, then ask again
      const latest = (await ProviderConnection.findById(conn._id).lean()) ?? conn;
      read = await readSwiggyOrders(await accessTokenFor(latest, def.name, true), def.base, want);
    }
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const o of read.orders) {
      const existing = await Transaction.findOne({ userId: auth.userId, externalRef: o.ref }).select('status').lean();
      const status = o.status === 'cancelled' ? 'failed' : o.status;
      if (existing) {
        // an order read while on its way is completed (or cancelled) the next time round
        if (existing.status !== status && existing.status === 'pending') {
          await Transaction.updateOne({ _id: existing._id }, { $set: { status } });
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
        { importSource: 'integration' },
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

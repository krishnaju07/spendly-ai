import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import { csrfTokenFor, randomToken, safeEqual, sha256 } from '../lib/crypto';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { Session, User, UserPreference, type UserDoc } from '../models/account';
import { DEFAULT_TIMEZONE } from '@spendly/shared';
import type { Types } from 'mongoose';

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = 'csrf';
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const TOUCH_INTERVAL_MS = 10 * 60_000;

const baseCookie = (httpOnly: boolean): CookieOptions => ({
  httpOnly,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE,
  path: '/',
});

/** IPv4 → /24, IPv6 → /48. Enough to recognise a device in the sessions list without storing exact addresses. */
function coarseIp(ip: string | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0');
  return ip.split(':').slice(0, 3).join(':') + '::';
}

export async function startSession(
  req: Request,
  res: Response,
  user: Pick<UserDoc, '_id' | 'isDemo' | 'demoExpiresAt'>,
): Promise<{ sessionId: Types.ObjectId; csrfToken: string }> {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = user.isDemo && user.demoExpiresAt ? user.demoExpiresAt : new Date(Date.now() + SESSION_TTL_MS);
  const session = await Session.create({
    userId: user._id,
    tokenHash,
    userAgent: (req.get('user-agent') ?? '').slice(0, 300),
    ip: coarseIp(req.ip),
    expiresAt,
  });
  const csrfToken = csrfTokenFor(tokenHash);
  res.cookie(SESSION_COOKIE, token, { ...baseCookie(true), expires: expiresAt });
  res.cookie(CSRF_COOKIE, csrfToken, { ...baseCookie(false), expires: expiresAt });
  return { sessionId: session._id, csrfToken };
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseCookie(true));
  res.clearCookie(CSRF_COOKIE, baseCookie(false));
}

/** Loads the signed-in user (if any) from the session cookie. Never rejects — see requireAuth. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token || typeof token !== 'string' || token.length > 200) return next();
    const tokenHash = sha256(token);
    const session = await Session.findOne({ tokenHash }).lean();
    if (!session || session.expiresAt.getTime() <= Date.now()) return next();

    const [user, prefs] = await Promise.all([
      User.findById(session.userId).lean(),
      UserPreference.findOne({ userId: session.userId }).lean(),
    ]);
    if (!user || !prefs) return next();
    if (user.isDemo && user.demoExpiresAt && user.demoExpiresAt.getTime() <= Date.now()) return next();

    req.auth = {
      userId: user._id,
      user,
      prefs,
      sessionId: session._id,
      sessionTokenHash: tokenHash,
      tz: prefs.timezone || DEFAULT_TIMEZONE,
      weekStartsOn: prefs.weekStartsOn === 7 ? 7 : 1,
    };

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const patch: Record<string, Date> = { lastSeenAt: new Date() };
      if (!user.isDemo) patch.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      void Session.updateOne({ _id: session._id }, { $set: patch }).catch(() => undefined);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Two independent CSRF defences: unsafe requests must carry a custom header (a cross-site form
 * cannot set one, and a cross-origin fetch would need a CORS preflight we never grant) and, when
 * signed in, a token that is an HMAC of the session — so it cannot be guessed or replayed
 * against another session.
 */
export const csrfProtection: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!UNSAFE.has(req.method)) return next();
  if (req.get('x-spendly-client') !== 'web') {
    return next(new AppError(403, 'CSRF_HEADER_MISSING', 'Missing client header'));
  }
  if (req.auth) {
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, csrfTokenFor(req.auth.sessionTokenHash))) {
      return next(forbidden('Your session security token is missing or stale. Refresh the page and try again.', 'CSRF_TOKEN_INVALID'));
    }
  }
  next();
};

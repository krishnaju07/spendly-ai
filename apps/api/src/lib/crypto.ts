import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const sha256Buffer = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

/** CSRF token bound to a session: HMAC(secret, sessionTokenHash). Stateless to verify. */
export function csrfTokenFor(sessionTokenHash: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`csrf:${sessionTokenHash}`).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Keyed hash of a sign-in code. A six-digit code has only a million possibilities, so the secret
 * key — not the hash — is what stops someone with a copy of the database from guessing offline.
 */
export const otpDigest = (phone: string, code: string): string =>
  createHmac('sha256', env.SESSION_SECRET).update(`otp:${phone}:${code}`).digest('hex');

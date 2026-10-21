import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
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

/**
 * Encrypts a secret that has to be read back later (a linked account's tokens). AES-256-GCM with a key derived from
 * SESSION_SECRET, so a copy of the database alone does not expose them; rotating the secret signs everyone out of
 * their links, which then have to be repeated.
 */
const sealKey = (): Buffer => Buffer.from(hkdfSync('sha256', env.SESSION_SECRET, 'spendly', 'linked-account-tokens', 32));

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Returns null for anything that was not sealed with the current key, rather than throwing on a bad value. */
export function unseal(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

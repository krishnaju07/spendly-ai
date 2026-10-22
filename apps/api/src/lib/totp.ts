import { createHmac, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@spendly/shared';

/** Time-based one-time codes (RFC 6238, as produced by Google Authenticator, 1Password, Authy and similar apps). */
const STEP_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodes a base32 secret (the form authenticator apps show); spaces, dashes, padding and case are ignored. Null if it is not base32. */
export function decodeBase32(input: string): Buffer | null {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const encodeBase32 = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

/** The code for one 30-second step (`counter` is Unix seconds divided by 30). */
export function totpAt(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** OTP_LENGTH).padStart(OTP_LENGTH, '0');
}

export const stepAt = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * The step `code` belongs to, allowing one step either side for a phone clock that is a little off;
 * null when it matches none. Every step is compared, so the time taken does not hint at how close a guess was.
 */
export function matchTotp(key: Buffer, code: string, nowMs = Date.now()): number | null {
  const now = stepAt(nowMs);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(key, step));
    const given = Buffer.from(code);
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = step;
  }
  return matched;
}

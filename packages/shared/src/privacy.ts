/**
 * Redaction for anything that leaves the system (AI prompts) or lands in logs. It is deliberately
 * aggressive: a masked merchant name is an inconvenience, a leaked card number is an incident.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const UPI_ID = /\b[\w.-]{2,}@[a-z]{2,}\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;
const LONG_NUMBER = /\b\d{9,}\b/g;

export function redactSensitive(input: string): string {
  return input
    .replace(EMAIL, '[email]')
    .replace(UPI_ID, '[upi-id]')
    .replace(PAN, '[pan]')
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 ? `[card ••${digits.slice(-4)}]` : m;
    })
    .replace(PHONE, '[phone]')
    .replace(LONG_NUMBER, '[number]');
}

/** Keys whose values must never be logged, in any casing. */
export const SENSITIVE_KEYS = [
  'password',
  'otp',
  'phone',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'api_key',
  'secret',
  'csrf',
  'x-csrf-token',
] as const;

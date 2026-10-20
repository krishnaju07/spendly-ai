/**
 * Mobile numbers. Spendly signs people in with a code texted to an Indian mobile number (+91, ten
 * digits, the first being 6–9). Numbers are stored in E.164 form (`+919876543210`) so the same
 * person always matches, however they typed it.
 */
export const PHONE_COUNTRY_CODE = '+91';
export const OTP_LENGTH = 6;

const NATIONAL = /^[6-9]\d{9}$/;

/** Digits left after removing a pasted country code (+91, 91, 0091) or trunk zero. */
function stripPrefix(input: string): string {
  const plus = input.trim().startsWith('+');
  const d = input.replace(/\D/g, '');
  if (plus && d.startsWith('91')) return d.slice(2);
  if (d.length > 10) {
    if (d.startsWith('0091')) return d.slice(4);
    if (d.startsWith('91')) return d.slice(2);
    if (d.startsWith('0')) return d.slice(1);
  }
  return d;
}

/** What to show in the number field while someone types or pastes: at most ten digits, no prefix. */
export const nationalDigits = (input: string): string => stripPrefix(input).slice(0, 10);

/** `98765 43210` — the way Indian mobile numbers are usually written. */
export const formatNational = (digits: string): string => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

/** Accepts "98765 43210", "+91 98765-43210", "098765 43210" or "919876543210"; returns `+919876543210`, or null. */
export function normalizePhone(input: string): string | null {
  if (/[^\d\s\-().+]/.test(input)) return null;
  const d = stripPrefix(input);
  return NATIONAL.test(d) ? `${PHONE_COUNTRY_CODE}${d}` : null;
}

/** `+91 98765 43210` */
export function formatPhone(phone: string): string {
  return phone.startsWith(PHONE_COUNTRY_CODE) ? `${PHONE_COUNTRY_CODE} ${formatNational(phone.slice(PHONE_COUNTRY_CODE.length))}` : phone;
}

/** `+91 98••• ••210` — enough to recognise your own number without showing it to someone looking over your shoulder. */
export function maskPhone(phone: string): string {
  if (!phone.startsWith(PHONE_COUNTRY_CODE)) return phone;
  const n = phone.slice(PHONE_COUNTRY_CODE.length);
  return n.length === 10 ? `${PHONE_COUNTRY_CODE} ${n.slice(0, 2)}••• ••${n.slice(7)}` : phone;
}

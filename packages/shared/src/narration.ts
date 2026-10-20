import { normalizeText, stripCorporateSuffixes, stripTrailingLocation } from './text';

/**
 * Indian bank and card narrations bury the merchant inside channel codes, reference numbers and
 * VPAs. This module pulls out the most likely payee without ever inventing one.
 *
 *   UPI-ZOMATO-zomato@hdfcbank-HDFC0000001-412345678901-UPI  -> ZOMATO
 *   UPI/P2M/412345678901/SWIGGY/Payment from PhonePe          -> SWIGGY
 *   POS 531234XXXXXX1234 BIRYANI BLUES BANGALORE IN           -> BIRYANI BLUES
 *   NEFT-HDFCN52026012345-ACME CORP-SALARY MAR                -> ACME CORP
 */

export type Channel =
  | 'upi'
  | 'pos'
  | 'ecom'
  | 'neft'
  | 'imps'
  | 'rtgs'
  | 'ach'
  | 'atm'
  | 'cheque'
  | 'card'
  | 'unknown';

export interface Narration {
  channel: Channel;
  /** Normalised merchant/payee candidate, or null when nothing usable remains. */
  merchant: string | null;
  vpa: string | null;
  reference: string | null;
  /** UPI P2A / P2P style transfers to individuals. */
  personToPerson: boolean;
}

const CHANNELS: Array<[Channel, RegExp]> = [
  ['upi', /\bUPI\b/i],
  ['atm', /\b(ATM|NWD|ATW|CASH WDL|CASH WITHDRAWAL)\b/i],
  ['pos', /\bPOS\b/i],
  ['ecom', /\b(ECOM|E-COM|ECOMM|PUR)\b/i],
  ['neft', /\bNEFT\b/i],
  ['imps', /\b(IMPS|MMT)\b/i],
  ['rtgs', /\bRTGS\b/i],
  ['ach', /\b(ACH|ECS|NACH)\b/i],
  ['cheque', /\b(CHQ|CHEQUE|CLG)\b/i],
];

const NOISE_WORDS = new Set([
  'UPI',
  'P2M',
  'P2A',
  'P2P',
  'P2PM',
  'DR',
  'CR',
  'DEBIT',
  'CREDIT',
  'TRANSFER',
  'TRF',
  'PAYMENT',
  'PAYMENTS',
  'PAID',
  'POS',
  'ECOM',
  'PUR',
  'IMPS',
  'MMT',
  'NEFT',
  'RTGS',
  'ACH',
  'ECS',
  'NACH',
  'NWD',
  'ATM',
  'TXN',
  'REF',
  'MOBILE',
  'BANKING',
  'ONLINE',
  'CARD',
  'PURCHASE',
  'PHONEPE',
  'GPAY',
  'BHIM',
]);

/** Connector words are noise at the edges of a segment ("TO TRANSFER") but part of a name inside it ("DISTRICT BY ZOMATO"). */
const EDGE_NOISE = new Set(['TO', 'FROM', 'BY', 'VIA', 'THROUGH', 'USING', 'FOR', 'NA', 'NULL', 'NIL', 'D', 'C']);

const BANK_CODES = new Set([
  'HDFC',
  'HDFCBANK',
  'ICIC',
  'ICICI',
  'ICICIBANK',
  'SBIN',
  'SBI',
  'AXIS',
  'AXISBANK',
  'UTIB',
  'KKBK',
  'KOTAK',
  'YESB',
  'YESBANK',
  'PUNB',
  'BARB',
  'IDFB',
  'INDB',
  'FDRL',
  'UBIN',
  'CNRB',
  'CBIN',
  'IBKL',
  'RATN',
  'OKAXIS',
  'OKHDFCBANK',
  'OKICICI',
  'OKSBI',
  'YBL',
  'IBL',
  'AXL',
  'APL',
]);

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MASKED_CARD = /^(?:\d{4,6}[X*]{2,}\d{2,4}|[X*]{4,}\d{4}|\d{4}[ -]?[X*]{4}[ -]?[X*]{4}[ -]?\d{4})$/i;
const VPA = /^[\w.-]{2,}@[a-z][a-z0-9.]{1,}$/i;

function isReferenceLike(token: string): boolean {
  const t = token.trim();
  if (/^\d{5,}$/.test(t)) return true;
  if (IFSC.test(t.toUpperCase())) return true;
  if (MASKED_CARD.test(t)) return true;
  // long alphanumeric ids with digits: HDFCN52026012345, 4XXXXXXXXXXX1234, AXISP00123456
  if (/^[A-Z0-9]{10,}$/i.test(t) && /\d/.test(t) && !/\s/.test(t)) return true;
  return false;
}

function detectChannel(raw: string): Channel {
  for (const [channel, pattern] of CHANNELS) if (pattern.test(raw)) return channel;
  return 'unknown';
}

function splitSegments(raw: string): string[] {
  const structuredDash = /^\s*(?:TO TRANSFER-|BY TRANSFER-)?(UPI|NEFT|IMPS|RTGS|ACH|NACH|MMT)(?:\s*(?:CR|DR|D|C))?\s*-/i.test(raw);
  const splitter = structuredDash ? /[/|~]|-(?=\S)/ : /[/|~]/;
  return raw
    .split(splitter)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanSegment(segment: string): string | null {
  const normalized = normalizeText(segment);
  if (!normalized) return null;
  const tokens = normalized.split(' ').filter((t) => !NOISE_WORDS.has(t) && !BANK_CODES.has(t));
  const filtered = tokens.filter((t) => !isReferenceLike(t));
  while (filtered.length > 0 && EDGE_NOISE.has(filtered[0] as string)) filtered.shift();
  while (filtered.length > 0 && EDGE_NOISE.has(filtered[filtered.length - 1] as string)) filtered.pop();
  if (filtered.length === 0) return null;
  // "PAYMENT FROM PHONEPE" style remarks collapse to nothing above; keep real names only.
  return filtered.join(' ');
}

function merchantFromVpa(vpa: string): string | null {
  const local = vpa.split('@')[0] ?? '';
  // generated merchant handles (paytmqr281005050101..., q123456789@ybl) carry no name
  if (/\d{6,}/.test(local) || /^(paytmqr|gpay|upi|q\d)/i.test(local)) return null;
  const normalized = normalizeText(local);
  return normalized.length >= 3 ? normalized : null;
}

export function parseNarration(raw: string): Narration {
  const text = raw.trim();
  const channel = detectChannel(text);
  const segments = splitSegments(text);
  const vpaCandidates = [...segments, ...text.split(/\s+/)];
  const vpaToken = vpaCandidates.find((c) => c.includes('@') && VPA.test(c.trim()));
  const vpa = vpaToken ? vpaToken.trim().toLowerCase() : null;
  const personToPerson = /\b(P2A|P2P)\b/i.test(text);

  const refMatch = /\b\d{9,16}\b/.exec(text);
  const reference = refMatch ? refMatch[0] : null;

  let merchant: string | null = null;

  if (segments.length > 1 || channel !== 'unknown') {
    const candidateSegments =
      segments.length > 1 ? segments : text.split(/\s+/).length > 1 ? [text] : segments;
    for (const segment of candidateSegments) {
      if (segment.includes('@')) continue;
      const cleaned = cleanSegment(segment);
      if (cleaned && /[A-Z]{2,}/.test(cleaned)) {
        merchant = cleaned;
        break;
      }
    }
  }

  if (!merchant && segments.length <= 1) {
    const cleaned = cleanSegment(text);
    if (cleaned) merchant = cleaned;
  }

  if (!merchant && vpa) merchant = merchantFromVpa(vpa);

  if (merchant) {
    merchant = stripTrailingLocation(stripCorporateSuffixes(merchant)) || merchant;
  }

  return { channel, merchant, vpa, reference, personToPerson };
}

import { describeDetail, parseItems, rupeesToPaise, type OrderDetail } from '@spendly/shared';

/**
 * Reading an order list the way each service writes it. The shapes are defensive on purpose: they were taught by looking
 * at a live Swiggy response, and a field a service does not send is reported by name, never guessed at.
 */

export interface ProviderOrder {
  /** Stable across syncs, so an order is stored once however often it is read. */
  ref: string;
  platform: string;
  merchantName: string;
  amountPaise: number;
  date: Date;
  status: 'completed' | 'pending' | 'cancelled';
  /** One line, for search and for anywhere without room for chips. */
  description: string;
  /** The restaurant, area and dishes, as data. */
  detail?: OrderDetail;
}

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

/** The list of orders inside whatever shape the tool answered with (a bare list, `{ orders }`, nested one level, or JSON text). */
export function ordersOf(payload: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'string' && depth === 0) {
    try {
      return ordersOf(JSON.parse(payload), 1);
    } catch {
      return null;
    }
  }
  if (isObj(payload) && depth < 3) {
    if (Array.isArray(payload.orders)) return payload.orders;
    for (const key of ['data', 'result']) {
      const inner = payload[key];
      if (isObj(inner) || Array.isArray(inner)) {
        const found = ordersOf(inner, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

const IST_MS = 5.5 * 3_600_000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Swiggy writes order times the way its app shows them — "October 8, 12:30 PM", with no year and no zone — or as
 * "2026-10-08 12:30:05" with no zone. Both are Indian time. With no year the order is the most recent such date that
 * is not in the future (the service only returns recent orders).
 */
export function parseIndianLocal(text: string, now = Date.now()): Date | null {
  const label = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(text.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(text.trim());
  let year: number | null, month: number, day: number, hour: number, minute: number, second: number;
  if (label || dayFirst) {
    // "October 8, 12:30 PM" (Swiggy) or "08 Oct, 12:30pm" (Zomato)
    const m = (label ?? dayFirst) as RegExpExecArray;
    month = MONTHS.indexOf((m[label ? 1 : 2] as string).slice(0, 3).toLowerCase());
    if (month < 0) return null;
    year = m[3] ? Number(m[3]) : null;
    day = Number(m[label ? 2 : 1]);
    hour = Number(m[4]);
    minute = Number(m[5]);
    second = Number(m[6] ?? 0);
    const meridiem = m[7]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    }
  } else if (iso) {
    [year, month, day, hour, minute, second] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]), Number(iso[5]), Number(iso[6] ?? 0)];
  } else return null;
  if (day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const at = (y: number) => Date.UTC(y, month, day, hour, minute, second) - IST_MS;
  if (year === null) {
    const thisYear = new Date(now + IST_MS).getUTCFullYear();
    // an order time is a real past moment, so only a little slack for clocks that disagree
    year = at(thisYear) > now + 2 * 3_600_000 ? thisYear - 1 : thisYear;
  }
  const d = new Date(at(year));
  // a day that does not exist (31 June) rolls over into the next month: that is not a date we can trust
  return new Date(d.getTime() + IST_MS).getUTCDate() === day ? d : null;
}

/**
 * A date as an app prints it on a list ("8 Oct 2026", "Oct 8", "08/10/2026"), as an ISO day. India reads day first.
 * Without a year the date is the most recent such day that is not in the future; `notAfter` (the entry above, when a list
 * runs newest first) pulls it back a year if that makes it newer than that entry.
 */
export function looseDateToIso(text: string, now = Date.now(), notAfter: string | null = null): string | null {
  const t = text.trim();
  let day: number, month: number, year: number | null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(t))) [day, month, year] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])];
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?/.exec(t))) [day, month, year] = [Number(m[1]), MONTHS.indexOf((m[2] as string).slice(0, 3).toLowerCase()), m[3] ? Number(m[3]) : null];
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/.exec(t))) [month, day, year] = [MONTHS.indexOf((m[1] as string).slice(0, 3).toLowerCase()), Number(m[2]), m[3] ? Number(m[3]) : null];
  else return null;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const at = (y: number) => Date.UTC(y, month, day, 12, 0) - IST_MS;
  if (year === null) {
    const thisYear = new Date(now + IST_MS).getUTCFullYear();
    year = at(thisYear) > now + 2 * 3_600_000 ? thisYear - 1 : thisYear;
    while (notAfter && new Date(at(year) + IST_MS).toISOString().slice(0, 10) > notAfter) year -= 1;
  }
  const d = new Date(at(year) + IST_MS);
  // a day that does not exist (31 June) rolls into the next month: not a date to trust
  return d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}

export function toDate(v: unknown, now = Date.now()): Date | null {
  let d: Date | null;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim()) {
    const text = v.trim();
    d = /^\d{9,13}$/.test(text) ? toDate(Number(text), now) : parseIndianLocal(text, now) ?? new Date(text);
  } else return null;
  const t = d?.getTime() ?? NaN;
  // an order cannot be in the future, and nothing from before these services existed is real
  return Number.isNaN(t) || t > now + 86_400_000 || t < Date.UTC(2010, 0, 1) ? null : (d as Date);
}

export function toPaise(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  try {
    const paise = rupeesToPaise(v);
    return paise > 0 ? paise : null;
  } catch {
    return null;
  }
}

export function statusOf(v: unknown): ProviderOrder['status'] {
  const s = String(v ?? '').toLowerCase();
  if (/cancel|reject|fail|refund/.test(s)) return 'cancelled';
  if (/deliver|complete|done|success/.test(s)) return 'completed';
  return 'pending';
}

const idOf = (o: Obj): string | null => {
  const v = pick(o, 'orderId', 'order_id', 'orderNumber', 'id');
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};

/** Turns raw orders into Spendly's shape; the ones that cannot be read safely are counted, never guessed at. */
const SOURCES = {
  food: { prefix: 'swiggy:food', platform: 'swiggy', name: 'Swiggy', fallback: 'Swiggy order' },
  instamart: { prefix: 'swiggy:im', platform: 'swiggy-instamart', name: 'Swiggy Instamart', fallback: 'Instamart order' },
  zomato: { prefix: 'zomato', platform: 'zomato', name: 'Zomato', fallback: 'Zomato order' },
} as const;
export type OrderSource = keyof typeof SOURCES;

export function parseOrders(raw: unknown[], kind: OrderSource, now = Date.now()): { orders: ProviderOrder[]; unreadable: number; missing: string[] } {
  const src = SOURCES[kind];
  const orders: ProviderOrder[] = [];
  const missing = new Set<string>();
  let unreadable = 0;
  let previous: Date | null = null;
  for (const item of raw) {
    if (!isObj(item)) {
      unreadable++;
      continue;
    }
    const id = idOf(item);
    const bill = isObj(item.billDetails) ? item.billDetails : {};
    const amount = toPaise(pick(item, 'orderTotal', 'totalAmount', 'total', 'grandTotal', 'orderAmount', 'amount', 'totalPrice', 'payment_amount') ?? pick(bill, 'grandTotal', 'total', 'toPay'));
    const when = pick(item, 'orderedTime', 'orderTime', 'placedAt', 'orderedAt', 'createdAt', 'orderDate', 'ordered_at', 'placed_at', 'payment_date', 'date');
    let date = toDate(when, now);
    // orders come newest first and a time like "June 12, 7:45 PM" has no year: if the guess makes an order newer than
    // the one before it, it belongs to an earlier year (someone who orders rarely can have five orders over two years)
    if (date && previous && typeof when === 'string' && !/\b\d{4}\b/.test(when)) {
      while (date.getTime() > previous.getTime() + 3_600_000) {
        const earlier: Date = new Date(date.getTime());
        earlier.setUTCFullYear(earlier.getUTCFullYear() - 1);
        date = earlier;
      }
    }
    if (!id || !amount || !date) {
      unreadable++;
      // which part, never its value: enough to see what to teach the reader without exposing an order
      if (!id) missing.add('order number');
      if (!amount) missing.add('total');
      if (!date) missing.add('time');
      continue;
    }
    previous = date;
    const restaurant = pick(item, 'restaurantName', 'restaurant_name', 'res_name') ?? (isObj(item.restaurant) ? item.restaurant.name : undefined);
    const area = pick(item, 'res_address', 'restaurantAreaName', 'restaurant_area', 'area');
    const detail: OrderDetail = {
      place: typeof restaurant === 'string' && restaurant.trim() ? restaurant.trim().slice(0, 160) : null,
      area: typeof area === 'string' && area.trim() ? area.trim().slice(0, 160) : null,
      items: parseItems(pick(item, 'orderedItems', 'items', 'products', 'lineItems', 'catalogue_items')),
    };
    const description = describeDetail(detail, src.fallback);
    orders.push({
      ref: `${src.prefix}:${id}`.slice(0, 80),
      platform: src.platform,
      merchantName: src.name,
      amountPaise: amount,
      date,
      status: statusOf(pick(item, 'orderStatus', 'status', 'state', 'payment_status')),
      description,
      detail,
    });
  }
  return { orders, unreadable, missing: [...missing] };
}


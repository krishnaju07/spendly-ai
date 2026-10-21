import { rupeesToPaise } from '@spendly/shared';
import { AppError } from '../lib/errors';
import { McpClient, payloadOf } from './mcp';

/**
 * Reads a signed-in person's recent Swiggy orders from Swiggy's official MCP server. Only the read-only history tools
 * are ever called: the same server can place orders, so the allowlists below are what keeps Spendly to reading.
 */

const FOOD_TOOLS: ReadonlySet<string> = new Set(['get_addresses', 'get_food_orders']);
const INSTAMART_TOOLS: ReadonlySet<string> = new Set(['get_orders']);

export interface ProviderOrder {
  /** Stable across syncs, so an order is stored once however often it is read. */
  ref: string;
  platform: 'swiggy' | 'swiggy-instamart';
  merchantName: string;
  amountPaise: number;
  date: Date;
  status: 'completed' | 'pending' | 'cancelled';
  description: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const pick = (o: Obj, ...keys: string[]): unknown => {
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
  let year: number | null, month: number, day: number, hour: number, minute: number, second: number;
  if (label) {
    month = MONTHS.indexOf((label[1] as string).slice(0, 3).toLowerCase());
    if (month < 0) return null;
    year = label[3] ? Number(label[3]) : null;
    day = Number(label[2]);
    hour = Number(label[4]);
    minute = Number(label[5]);
    second = Number(label[6] ?? 0);
    const meridiem = label[7]?.toLowerCase();
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
  if (/cancel|reject|fail/.test(s)) return 'cancelled';
  if (/deliver|complete|done|success/.test(s)) return 'completed';
  return 'pending';
}

function describeItems(items: unknown): string {
  // Food sends the items as one comma-separated sentence
  if (typeof items === 'string') return items.trim().slice(0, 240);
  if (!Array.isArray(items)) return '';
  const names = items
    .map((i) => {
      if (typeof i === 'string') return i;
      if (!isObj(i)) return '';
      const name = pick(i, 'name', 'itemName', 'item_name', 'title', 'productName');
      const qty = Number(pick(i, 'quantity', 'qty', 'count'));
      return typeof name === 'string' ? (qty > 1 ? `${name} ×${qty}` : name) : '';
    })
    .filter(Boolean);
  if (!names.length) return '';
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4} more` : names.join(', ');
}

const idOf = (o: Obj): string | null => {
  const v = pick(o, 'orderId', 'order_id', 'id');
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};

/** Turns raw orders into Spendly's shape; the ones that cannot be read safely are counted, never guessed at. */
export function parseOrders(raw: unknown[], kind: 'food' | 'instamart', now = Date.now()): { orders: ProviderOrder[]; unreadable: number; missing: string[] } {
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
    const amount = toPaise(pick(item, 'orderTotal', 'totalAmount', 'total', 'grandTotal') ?? pick(bill, 'grandTotal', 'total', 'toPay'));
    const when = pick(item, 'orderedTime', 'orderTime', 'placedAt', 'createdAt', 'orderDate', 'ordered_at');
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
    const restaurant = pick(item, 'restaurantName', 'restaurant_name') ?? (isObj(item.restaurant) ? item.restaurant.name : undefined);
    const items = describeItems(pick(item, 'orderedItems', 'items'));
    const description = [typeof restaurant === 'string' ? restaurant : '', items].filter(Boolean).join(' · ').slice(0, 480) || (kind === 'food' ? 'Swiggy order' : 'Instamart order');
    orders.push({
      ref: `swiggy:${kind === 'food' ? 'food' : 'im'}:${id}`.slice(0, 80),
      platform: kind === 'food' ? 'swiggy' : 'swiggy-instamart',
      merchantName: kind === 'food' ? 'Swiggy' : 'Swiggy Instamart',
      amountPaise: amount,
      date,
      status: statusOf(pick(item, 'orderStatus', 'status')),
      description,
    });
  }
  return { orders, unreadable, missing: [...missing] };
}

function firstAddressId(payload: unknown): string | null {
  const list = Array.isArray(payload) ? payload : isObj(payload) ? (payload.addresses ?? (isObj(payload.data) ? payload.data.addresses : undefined)) : undefined;
  if (!Array.isArray(list)) return null;
  for (const a of list) {
    if (!isObj(a)) continue;
    const id = pick(a, 'id', 'addressId', 'address_id');
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return null;
}

/** Orders came back but not one could be understood: that is a failure to report, not "nothing new". */
const unreadableAll = (what: string, count: number, missing: string[]) =>
  new AppError(502, 'PROVIDER_FORMAT', `Swiggy sent ${count} ${what} order${count === 1 ? '' : 's'}, but Spendly could not read their ${missing.join(' or ') || 'details'}, so nothing was imported.`);

const unrecognised = (what: string) =>
  new AppError(502, 'PROVIDER_FORMAT', `Swiggy sent ${what} in a form Spendly does not understand yet, so nothing was imported.`);

export async function readSwiggyOrders(
  token: string,
  base: string,
  want: { food: boolean; instamart: boolean },
): Promise<{ orders: ProviderOrder[]; scanned: number; notes: string[] }> {
  const orders: ProviderOrder[] = [];
  const notes: string[] = [];
  let scanned = 0;

  if (want.food) {
    const food = new McpClient(`${base}/food`, token, FOOD_TOOLS);
    const addressId = firstAddressId(payloadOf(await food.call('get_addresses')));
    if (!addressId) {
      notes.push('Swiggy has no saved address on this account, so Food orders were skipped.');
    } else {
      const raw = ordersOf(payloadOf(await food.call('get_food_orders', { addressId, orderCount: 15 })));
      if (!raw) throw unrecognised('your Food orders');
      const parsed = parseOrders(raw, 'food');
      if (raw.length && !parsed.orders.length) throw unreadableAll('Food', raw.length, parsed.missing);
      scanned += raw.length;
      orders.push(...parsed.orders);
      if (parsed.unreadable) notes.push(`${parsed.unreadable} Food order${parsed.unreadable === 1 ? '' : 's'} could not be read (${parsed.missing.join(', ')}) and ${parsed.unreadable === 1 ? 'was' : 'were'} skipped.`);
    }
  }

  if (want.instamart) {
    const im = new McpClient(`${base}/im`, token, INSTAMART_TOOLS);
    const raw = ordersOf(payloadOf(await im.call('get_orders', { count: 20, orderType: 'DASH' })));
    if (!raw) throw unrecognised('your Instamart orders');
    const parsed = parseOrders(raw, 'instamart');
    if (raw.length && !parsed.orders.length) throw unreadableAll('Instamart', raw.length, parsed.missing);
    scanned += raw.length;
    orders.push(...parsed.orders);
    if (parsed.unreadable) notes.push(`${parsed.unreadable} Instamart order${parsed.unreadable === 1 ? '' : 's'} could not be read (${parsed.missing.join(', ')}) and ${parsed.unreadable === 1 ? 'was' : 'were'} skipped.`);
  }
  return { orders, scanned, notes };
}

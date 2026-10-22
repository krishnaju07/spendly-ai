import { AppError } from '../lib/errors';
import { McpClient, payloadOf } from './mcp';
import { isObj, ordersOf, parseOrders, pick, type ProviderOrder } from './order-parse';

/**
 * Reads a signed-in person's recent Swiggy orders from Swiggy's official MCP server. Only the read-only history tools
 * are ever called: the same server can place orders, so the allowlists below are what keeps Spendly to reading.
 */

const FOOD_TOOLS: ReadonlySet<string> = new Set(['get_addresses', 'get_food_orders']);
const INSTAMART_TOOLS: ReadonlySet<string> = new Set(['get_orders']);

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

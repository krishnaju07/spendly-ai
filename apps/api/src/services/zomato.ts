import { AppError } from '../lib/errors';
import { McpClient, payloadOf } from './mcp';
import { isObj, parseOrders, type ProviderOrder } from './order-parse';

/**
 * Reads a signed-in person's Zomato order history from Zomato's official MCP server. Only two read-only tools are ever
 * called: the same server can build carts and place orders.
 *
 * Shapes taught by a live account (Oct 2026): `get_saved_addresses_for_user` answers `{ result: { addresses: [{ address_id,
 * location_name }] } }`; `get_order_history({ address_id })` answers `{ result: { order_history: { order_history_items: [{
 * order_id, res_name, payment_amount "₹999.99", payment_status, payment_date "08 Oct, 12:30pm", catalogue_items: [{ name,
 * quantity }] }], has_more, postback_params } } }`, twenty a page, newest first. The history is the same whichever address is
 * given. Dates carry no year. The next page needs `postback_params` sent back encoded twice: the server decodes a JSON-looking
 * string argument once before checking that it is a string.
 */
const TOOLS: ReadonlySet<string> = new Set(['get_saved_addresses_for_user', 'get_order_history']);
const MAX_PAGES = 10;

function firstAddressId(payload: unknown): string | null {
  const root = isObj(payload) && isObj(payload.result) ? payload.result : payload;
  const list = isObj(root) ? root.addresses : undefined;
  if (!Array.isArray(list)) return null;
  for (const a of list) {
    if (isObj(a) && (typeof a.address_id === 'string' || typeof a.address_id === 'number')) return String(a.address_id);
  }
  return null;
}

interface HistoryPage {
  items: unknown[];
  hasMore: boolean;
  cursor: unknown;
}

function pageOf(payload: unknown): HistoryPage | null {
  const result = isObj(payload) && isObj(payload.result) ? payload.result : payload;
  const history = isObj(result) && isObj(result.order_history) ? result.order_history : null;
  if (!history || !Array.isArray(history.order_history_items)) return null;
  return { items: history.order_history_items, hasMore: history.has_more === true, cursor: history.postback_params };
}

export async function readZomatoOrders(
  token: string,
  base: string,
  /** Orders already saved: paging stops at the first page made only of these, so a later sync reads one page, not the lot. */
  stored: ReadonlySet<string>,
): Promise<{ orders: ProviderOrder[]; scanned: number; notes: string[] }> {
  const client = new McpClient(`${base}/mcp`, token, TOOLS);
  const addressId = firstAddressId(payloadOf(await client.call('get_saved_addresses_for_user', {})));
  if (!addressId) throw new AppError(502, 'PROVIDER_FORMAT', 'Zomato has no saved address on this account, and its order history needs one, so nothing was imported.');

  const raw: unknown[] = [];
  let args: Record<string, unknown> = { address_id: addressId };
  let pages = 0;
  let capped = false;
  for (;;) {
    const page = pageOf(payloadOf(await client.call('get_order_history', args)));
    if (!page) throw new AppError(502, 'PROVIDER_FORMAT', 'Zomato sent your orders in a form Spendly does not understand yet, so nothing was imported.');
    raw.push(...page.items);
    pages++;
    const allStored = page.items.length > 0 && page.items.every((o) => isObj(o) && stored.has(`zomato:${String(o.order_id)}`));
    if (!page.hasMore || !page.cursor || allStored) break;
    if (pages >= MAX_PAGES) {
      capped = true;
      break;
    }
    const cursor = typeof page.cursor === 'string' ? page.cursor : JSON.stringify(page.cursor);
    args = { address_id: addressId, has_more: true, postback_params: JSON.stringify(cursor) };
  }
  if (!raw.length) return { orders: [], scanned: 0, notes: ['Zomato returned no orders.'] };

  const parsed = parseOrders(raw, 'zomato');
  if (!parsed.orders.length) {
    throw new AppError(502, 'PROVIDER_FORMAT', `Zomato sent ${raw.length} order${raw.length === 1 ? '' : 's'}, but Spendly could not read their ${parsed.missing.join(' or ') || 'details'}, so nothing was imported.`);
  }
  const notes: string[] = [];
  if (parsed.unreadable) notes.push(`${parsed.unreadable} order${parsed.unreadable === 1 ? '' : 's'} could not be read (${parsed.missing.join(', ')}) and ${parsed.unreadable === 1 ? 'was' : 'were'} skipped.`);
  if (capped) notes.push(`Only the latest ${raw.length} orders were read. Zomato prints no year on older orders, so very old ones can be dated a year out: check them.`);
  return { orders: parsed.orders, scanned: raw.length, notes };
}

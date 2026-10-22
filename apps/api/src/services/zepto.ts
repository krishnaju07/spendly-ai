import { AppError } from '../lib/errors';
import { McpClient, payloadOf } from './mcp';
import { isObj, ordersOf, pick, statusOf, toDate, type ProviderOrder } from './order-parse';

/**
 * Reads a signed-in person's Zepto order history from Zepto's official MCP server, with its read-only `tools:read`
 * scope. Only the two history tools are ever called: the same server can build carts and place orders.
 *
 * Shapes taught by a live account (Oct 2026): `list_order_history` answers `{ orders: [{ id, code, formattedStatus,
 * grandTotalAmount, totalRefundAmount, productsNamesAndCounts }], count }` with no time at all; `get_order_detail`
 * adds `placedTime` (ISO, UTC) and the products per shipment. Amounts are whole numbers of paise.
 */
const TOOLS: ReadonlySet<string> = new Set(['list_order_history', 'get_order_detail']);
const LIMIT = 20;

/** A whole number of paise, or null: a figure that is not one is reported, never guessed at. */
function paiseOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && /^\d{1,12}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function itemsOf(detail: unknown): string {
  if (!isObj(detail) || !Array.isArray(detail.shipments)) return '';
  const names: string[] = [];
  for (const shipment of detail.shipments) {
    if (!isObj(shipment) || !Array.isArray(shipment.products)) continue;
    for (const product of shipment.products) {
      if (!isObj(product)) continue;
      const name = pick(product, 'productName', 'name');
      const qty = Number(pick(product, 'quantityOrdered', 'quantity'));
      if (typeof name === 'string') names.push(qty > 1 ? `${name} ×${qty}` : name);
    }
  }
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4} more` : names.join(', ');
}

export async function readZeptoOrders(
  token: string,
  base: string,
  /** Orders already saved: their time and items are not asked for again. */
  stored: ReadonlySet<string>,
): Promise<{ orders: ProviderOrder[]; scanned: number; notes: string[] }> {
  const client = new McpClient(`${base}/mcp`, token, TOOLS);
  const rows = ordersOf(payloadOf(await client.call('list_order_history', { limit: LIMIT })));
  if (!rows) throw new AppError(502, 'PROVIDER_FORMAT', 'Zepto sent your orders in a form Spendly does not understand yet, so nothing was imported.');
  if (!rows.length) return { orders: [], scanned: 0, notes: ['Zepto returned no orders.'] };

  const orders: ProviderOrder[] = [];
  const missing = new Set<string>();
  let unreadable = 0;
  for (const row of rows) {
    const id = isObj(row) ? pick(row, 'id', 'orderId') : undefined;
    const total = isObj(row) ? paiseOf(pick(row, 'grandTotalAmount')) : null;
    if (typeof id !== 'string' || !total) {
      unreadable++;
      if (typeof id !== 'string') missing.add('order number');
      if (!total) missing.add('total');
      continue;
    }
    const ref = `zepto:${id}`.slice(0, 80);
    const refund = paiseOf((row as Record<string, unknown>).totalRefundAmount) ?? 0;
    const net = total - refund;
    // an order refunded in full never cost anything: it is a cancellation
    const status = net <= 0 ? 'cancelled' : statusOf((row as Record<string, unknown>).formattedStatus);
    if (stored.has(ref)) {
      // already saved: only its status can have changed, so its time is not asked for again
      orders.push({ ref, platform: 'zepto', merchantName: 'Zepto', amountPaise: Math.max(net, 1), date: new Date(0), status, description: 'Zepto order' });
      continue;
    }
    const detail = payloadOf(await client.call('get_order_detail', { orderId: id }));
    const placed = isObj(detail) ? pick(detail, 'placedTime') ?? (Array.isArray(detail.shipments) && isObj(detail.shipments[0]) ? detail.shipments[0].placedTime : undefined) : undefined;
    const date = toDate(placed);
    if (!date) {
      unreadable++;
      missing.add('time');
      continue;
    }
    orders.push({ ref, platform: 'zepto', merchantName: 'Zepto', amountPaise: Math.max(net, 1), date, status, description: itemsOf(detail) || 'Zepto order' });
  }
  if (rows.length && !orders.length) {
    throw new AppError(502, 'PROVIDER_FORMAT', `Zepto sent ${rows.length} order${rows.length === 1 ? '' : 's'}, but Spendly could not read their ${[...missing].join(' or ') || 'details'}, so nothing was imported.`);
  }
  const notes = unreadable ? [`${unreadable} order${unreadable === 1 ? '' : 's'} could not be read (${[...missing].join(', ')}) and ${unreadable === 1 ? 'was' : 'were'} skipped.`] : [];
  return { orders, scanned: rows.length, notes };
}

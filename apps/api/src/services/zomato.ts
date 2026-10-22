import { AppError } from '../lib/errors';
import { McpClient, payloadOf } from './mcp';
import { ordersOf, parseOrders, type ProviderOrder } from './order-parse';

/**
 * Reads a signed-in person's Zomato order history from Zomato's official MCP server. Only the history tool is ever
 * called: the same server can place orders.
 *
 * Zomato opens its MCP to personal-use apps whose return address it has approved. The history tool's name comes from
 * Zomato's public tool catalogue and what it returns has not been seen on a real account yet, so a Zomato sync asks the
 * person to confirm what it found before anything is saved; anything unreadable is named, never guessed at.
 */
const TOOLS: ReadonlySet<string> = new Set(['get_order_history']);

export async function readZomatoOrders(token: string, base: string): Promise<{ orders: ProviderOrder[]; scanned: number; notes: string[] }> {
  const client = new McpClient(`${base}/mcp`, token, TOOLS);
  const raw = ordersOf(payloadOf(await client.call('get_order_history', {})));
  if (!raw) throw new AppError(502, 'PROVIDER_FORMAT', 'Zomato sent your orders in a form Spendly does not understand yet, so nothing was imported.');
  if (!raw.length) return { orders: [], scanned: 0, notes: ['Zomato returned no orders.'] };
  const parsed = parseOrders(raw, 'zomato');
  if (!parsed.orders.length) {
    throw new AppError(502, 'PROVIDER_FORMAT', `Zomato sent ${raw.length} order${raw.length === 1 ? '' : 's'}, but Spendly could not read their ${parsed.missing.join(' or ') || 'details'}, so nothing was imported.`);
  }
  const notes = parsed.unreadable ? [`${parsed.unreadable} order${parsed.unreadable === 1 ? '' : 's'} could not be read (${parsed.missing.join(', ')}) and ${parsed.unreadable === 1 ? 'was' : 'were'} skipped.`] : [];
  return { orders: parsed.orders, scanned: raw.length, notes };
}

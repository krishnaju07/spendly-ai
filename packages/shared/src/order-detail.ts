/**
 * What an order was, as data: where it came from and what was in it. Linked accounts (Zomato, Swiggy, Zepto) say this
 * in different shapes, so it is read once into this one and shown the same way everywhere.
 */

export interface OrderItem {
  name: string;
  quantity: number;
  /** The veg / non-veg mark food apps show next to a dish; null when the app does not say. */
  diet: 'veg' | 'nonveg' | 'egg' | null;
}

export interface OrderDetail {
  /** The restaurant or shop; null for a grocery order, which has no single place. */
  place: string | null;
  /** The neighbourhood, when the app gives one. */
  area: string | null;
  items: OrderItem[];
}

const MAX_ITEMS = 40;

export function dietOf(value: unknown): OrderItem['diet'] {
  if (typeof value === 'boolean') return value ? 'veg' : 'nonveg';
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (/non[\s_-]?veg/.test(v)) return 'nonveg';
  if (/\begg/.test(v)) return 'egg';
  if (/veg/.test(v)) return 'veg';
  return null;
}

/** Splits on commas, but not the ones inside brackets: "Chicken 65 (Boneless, 6 pcs), Naan" is two dishes. */
function splitDishes(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** "Chicken Biryani x 2", "Biryani ×2" or "2 x Biryani" into a name and a count. */
function dish(text: string): OrderItem | null {
  let name = text.trim();
  let quantity = 1;
  const trailing = /\s*[x×]\s*(\d{1,3})\s*$/i.exec(name);
  const leading = /^(\d{1,3})\s*[x×]\s+/i.exec(name);
  if (trailing) {
    quantity = Number(trailing[1]);
    name = name.slice(0, trailing.index).trim();
  } else if (leading) {
    quantity = Number(leading[1]);
    name = name.slice(leading[0].length).trim();
  }
  return name ? { name: name.slice(0, 120), quantity: Math.max(1, quantity), diet: null } : null;
}

/** Dishes from a sentence ("A x 2, B") or from a list of names or of objects an app sent. */
export function parseItems(value: unknown): OrderItem[] {
  const items: OrderItem[] = [];
  if (typeof value === 'string') {
    for (const part of splitDishes(value)) {
      const d = dish(part);
      if (d) items.push(d);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string') {
        const d = dish(v);
        if (d) items.push(d);
      } else if (typeof v === 'object' && v !== null) {
        const o = v as Record<string, unknown>;
        const name = [o.name, o.itemName, o.item_name, o.title, o.productName].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
        if (!name) continue;
        const qty = Number([o.quantity, o.qty, o.count, o.quantityOrdered].find((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))));
        items.push({ name: name.trim().slice(0, 120), quantity: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 999) : 1, diet: dietOf(o.dietary_tag ?? o.dietaryTag ?? o.diet ?? o.veg_nonveg ?? o.isVeg) });
      }
    }
  }
  return items.slice(0, MAX_ITEMS);
}

/** The order on one line — for search and for anywhere that has no room for chips. */
export function describeDetail(detail: OrderDetail | null | undefined, fallback = ''): string {
  if (!detail) return fallback;
  const dishes = detail.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name));
  const shown = dishes.length > 4 ? `${dishes.slice(0, 4).join(', ')} +${dishes.length - 4} more` : dishes.join(', ');
  return [detail.place, shown].filter(Boolean).join(' · ').slice(0, 480) || fallback;
}

/**
 * An order saved before details were kept: its one-line description was "Place · A ×2, B", so take it apart again.
 * Only for a source that wrote it that way (a linked account); anything else is someone's own words.
 */
export function legacyDetail(description: string): OrderDetail | null {
  const cut = description.indexOf(' · ');
  if (cut < 1) return null;
  const items = parseItems(description.slice(cut + 3).replace(/\s+\+\d+ more$/, ''));
  return items.length ? { place: description.slice(0, cut), area: null, items } : null;
}

import { DateTime } from 'luxon';
import type { PaymentMethod, TransactionType } from './constants';

/**
 * Deterministic sample history for the *demo workspace only*. Everything generated here is flagged
 * as demo data by the API and can never be mixed into a real account. The data is built to
 * exercise every feature honestly: recurring subscriptions (with a price change), refunds linked
 * to the original purchase, a double charge, one unusually large purchase, late-night orders,
 * transfers that must not count as spending, and salary income.
 */

export interface DemoTransaction {
  merchantName: string;
  description: string;
  platform: string | null;
  category: string;
  subcategory: string | null;
  amountPaise: number;
  date: Date;
  hasTime: boolean;
  paymentMethod: PaymentMethod;
  type: TransactionType;
  externalRef?: string;
  /** Index (in the returned, date-sorted array) of the purchase this refund reverses. */
  refundOfIndex?: number;
  tags?: string[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draft = Omit<DemoTransaction, 'date'> & { date: DateTime; key?: string };

export function generateDemoTransactions(opts: { now: Date; tz: string; months?: number; seed?: number }): DemoTransaction[] {
  const { tz } = opts;
  const rand = mulberry32(opts.seed ?? 20_26);
  const months = opts.months ?? 6;
  const now = DateTime.fromJSDate(opts.now, { zone: tz });
  const start = now.startOf('month').minus({ months: months - 1 });
  const today = now.startOf('day');

  const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const chance = (p: number) => rand() < p;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const rupees = (median: number, spread = 0.45, min = 40, max = 20_000) => {
    const u = Math.max(1e-9, rand());
    const v = Math.max(1e-9, rand());
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.min(max, Math.max(min, Math.round(median * Math.exp(spread * z))));
  };
  const utr = () => String(int(400_000_000_000, 499_999_999_999));

  const out: Draft[] = [];
  const push = (
    day: DateTime,
    hour: number,
    d: Omit<Draft, 'date' | 'hasTime' | 'type'> & { type?: TransactionType; hasTime?: boolean },
  ) => {
    const at = day.set({ hour: Math.min(23, hour), minute: int(0, 59), second: int(0, 59) });
    if (at > now) return;
    out.push({ type: 'expense', hasTime: true, ...d, date: at });
  };
  const upiOrCard = (): PaymentMethod => (chance(0.62) ? 'upi' : 'credit_card');
  const mealHour = () => (chance(0.1) ? pick([23, 0, 1]) : chance(0.45) ? int(12, 14) : int(19, 22));

  const totalDays = Math.ceil(today.diff(start, 'days').days);
  for (let i = 0; i <= totalDays; i++) {
    const day = start.plus({ days: i });
    if (day > today) break;
    const dom = day.day;
    const dow = day.weekday; // 1 Mon … 7 Sun
    const weekend = dow >= 6;
    const fri = dow === 5;
    const monthsAgo = Math.round(now.startOf('month').diff(day.startOf('month'), 'months').months);
    // food delivery gets steadily more frequent towards the present
    const ordering = 1 + (months - 1 - monthsAgo) * 0.08;

    // ── fixed monthly items ──────────────────────────────────────────────────────────────
    if (dom === 1) push(day, 10, { merchantName: 'Acme Corp Salary', description: 'NEFT CR-ACME CORP-SALARY', platform: null, category: 'income', subcategory: 'Salary', amountPaise: 9_500_000, paymentMethod: 'bank_transfer', type: 'income' });
    if (dom === 3) push(day, 9, { merchantName: 'House rent', description: 'UPI/P2A/RENT TO LANDLORD', platform: 'rent', category: 'rent', subcategory: 'Rent', amountPaise: 2_800_000, paymentMethod: 'bank_transfer', externalRef: utr() });
    if (dom === 5) {
      push(day, 11, { merchantName: 'ACT Fibernet', description: 'ACT FIBERNET BROADBAND', platform: 'utilities', category: 'bills', subcategory: 'Internet & mobile', amountPaise: 117_900, paymentMethod: 'upi', externalRef: utr() });
      push(day, 12, { merchantName: 'Groww SIP', description: 'GROWW MUTUAL FUND SIP', platform: null, category: 'investments', subcategory: 'Mutual funds & SIPs', amountPaise: 1_000_000, paymentMethod: 'bank_transfer', type: 'transfer' });
    }
    if (dom === 2) push(day, 8, { merchantName: 'Amazon Prime', description: 'AMAZON PRIME MEMBERSHIP', platform: 'prime-video', category: 'subscriptions', subcategory: 'Streaming', amountPaise: 29_900, paymentMethod: 'credit_card' });
    if (dom === 7) push(day, 8, { merchantName: 'Netflix', description: 'NETFLIX.COM', platform: 'netflix', category: 'subscriptions', subcategory: 'Streaming', amountPaise: monthsAgo <= 1 ? 69_900 : 64_900, paymentMethod: 'credit_card' });
    if (dom === 10) push(day, 15, { merchantName: 'BESCOM', description: 'BESCOM ELECTRICITY BILL', platform: 'utilities', category: 'bills', subcategory: 'Electricity', amountPaise: rupees(2200, 0.18, 1500, 3200) * 100, paymentMethod: 'upi', externalRef: utr() });
    if (dom === 12) push(day, 9, { merchantName: 'Airtel', description: 'AIRTEL PREPAID RECHARGE', platform: 'utilities', category: 'bills', subcategory: 'Internet & mobile', amountPaise: 39_900, paymentMethod: 'upi', externalRef: utr() });
    if (dom === 14) push(day, 8, { merchantName: 'Spotify', description: 'SPOTIFY INDIA', platform: 'spotify', category: 'subscriptions', subcategory: 'Music', amountPaise: 11_900, paymentMethod: 'credit_card' });
    if (dom === 15) push(day, 10, { merchantName: 'Cult.fit', description: 'CULT FIT MEMBERSHIP', platform: null, category: 'personal-care', subcategory: 'Gym & fitness', amountPaise: 150_000, paymentMethod: 'credit_card' });
    if (dom === 18) push(day, 13, { merchantName: 'HDFC credit card bill', description: 'CREDIT CARD PAYMENT HDFC', platform: null, category: 'transfers', subcategory: 'Credit card bill', amountPaise: rupees(32_000, 0.2, 18_000, 48_000) * 100, paymentMethod: 'net_banking', type: 'transfer' });
    if (dom === 20) push(day, 8, { merchantName: 'YouTube Premium', description: 'GOOGLE YOUTUBEPREMIUM', platform: 'youtube-premium', category: 'subscriptions', subcategory: 'Streaming', amountPaise: 14_900, paymentMethod: 'credit_card' });

    // ── food delivery (more at weekends, rising over time) ─────────────────────────────────
    if (chance(((weekend ? 0.55 : fri ? 0.42 : 0.2) * ordering))) {
      const zomato = chance(0.6);
      push(day, mealHour(), {
        merchantName: zomato ? 'Zomato' : 'Swiggy',
        description: zomato ? 'UPI-ZOMATO-zomato@hdfcbank-HDFC0000001' : 'UPI/P2M/SWIGGY/Payment from PhonePe',
        platform: zomato ? 'zomato' : 'swiggy',
        category: 'food-delivery',
        subcategory: 'Restaurant orders',
        amountPaise: rupees(zomato ? 410 : 360, 0.4, 120, 1600) * 100,
        paymentMethod: upiOrCard(),
        externalRef: utr(),
      });
    }
    // ── quick commerce ─────────────────────────────────────────────────────────────────────
    for (const [slug, name, p, median] of [['zepto', 'Zepto', 0.2, 320], ['blinkit', 'Blinkit', 0.14, 280], ['swiggy-instamart', 'Swiggy Instamart', 0.08, 410]] as const) {
      if (chance(p)) push(day, int(17, 22), { merchantName: name, description: name.toUpperCase(), platform: slug, category: 'groceries', subcategory: 'Quick commerce', amountPaise: (rupees(median, 0.5, 90, 2500) * 100) + (chance(0.4) ? int(1, 99) : 0), paymentMethod: 'upi', externalRef: utr() });
    }
    if (dow === 6 && chance(0.4)) push(day, 11, { merchantName: 'DMart', description: 'POS 531234XXXXXX1234 AVENUE SUPERMARTS DMART', platform: null, category: 'groceries', subcategory: 'Supermarket', amountPaise: rupees(2300, 0.3, 900, 5000) * 100 + int(0, 99), paymentMethod: 'debit_card' });
    if (dow === 7 && chance(0.18)) push(day, 12, { merchantName: 'BigBasket', description: 'BIGBASKET', platform: 'bigbasket', category: 'groceries', subcategory: 'Supermarket', amountPaise: rupees(1900, 0.3, 800, 4000) * 100, paymentMethod: 'credit_card' });
    // ── dining out and cafes (many small purchases) ────────────────────────────────────────
    if (chance(weekend ? 0.3 : 0.1)) push(day, int(13, 21), { merchantName: pick(['Biryani Blues', 'Truffles', 'Toit', 'Meghana Foods']), description: 'POS 531234XXXXXX1234 RESTAURANT BANGALORE', platform: 'restaurants', category: 'dining-out', subcategory: 'Restaurants', amountPaise: rupees(1100, 0.45, 300, 4500) * 100, paymentMethod: pick(['credit_card', 'upi'] as const) });
    if (chance(weekend ? 0.3 : 0.4)) push(day, int(8, 18), { merchantName: pick(['Third Wave Coffee', 'Blue Tokai', 'Chai Point', 'Starbucks']), description: 'CAFE COFFEE', platform: 'cafes', category: 'dining-out', subcategory: 'Cafes', amountPaise: rupees(240, 0.3, 90, 700) * 100, paymentMethod: 'upi', externalRef: utr() });
    // ── entertainment ──────────────────────────────────────────────────────────────────────
    if ((weekend || fri) && chance(0.17)) push(day, int(15, 20), { merchantName: 'BookMyShow', description: 'BOOKMYSHOW', platform: 'bookmyshow', category: 'entertainment', subcategory: 'Movies', amountPaise: rupees(780, 0.35, 300, 2400) * 100, paymentMethod: 'credit_card' });
    if (weekend && chance(0.06)) push(day, int(10, 18), { merchantName: 'District', description: 'DISTRICT BY ZOMATO', platform: 'district', category: 'entertainment', subcategory: 'Events & concerts', amountPaise: rupees(1500, 0.5, 500, 5000) * 100, paymentMethod: 'upi', externalRef: utr() });
    // ── shopping ───────────────────────────────────────────────────────────────────────────
    if (chance(0.13)) push(day, int(10, 23), { merchantName: 'Amazon', description: 'AMAZON.IN', platform: 'amazon', category: 'shopping', subcategory: 'Online shopping', amountPaise: rupees(900, 0.7, 150, 9000) * 100 + int(0, 99), paymentMethod: 'credit_card' });
    if (chance(0.06)) push(day, int(10, 22), { merchantName: 'Flipkart', description: 'FLIPKART INTERNET PVT LTD', platform: 'flipkart', category: 'shopping', subcategory: 'Online shopping', amountPaise: rupees(1100, 0.6, 200, 7000) * 100, paymentMethod: 'credit_card' });
    if (dom === 22 && chance(0.7)) push(day, 20, { merchantName: 'Myntra', description: 'MYNTRA DESIGNS', platform: 'myntra', category: 'shopping', subcategory: 'Fashion', amountPaise: rupees(2200, 0.4, 800, 6000) * 100, paymentMethod: 'credit_card' });
    // ── transport and fuel ─────────────────────────────────────────────────────────────────
    if (chance(weekend ? 0.3 : 0.38)) push(day, pick([8, 9, 18, 19, 21]), { merchantName: 'Uber', description: 'UBER INDIA SYSTEMS PVT LTD', platform: 'uber', category: 'transport', subcategory: 'Cabs & autos', amountPaise: rupees(260, 0.5, 90, 1200) * 100, paymentMethod: 'credit_card' });
    if (chance(0.15)) push(day, pick([9, 18]), { merchantName: 'Rapido', description: 'RAPIDO', platform: 'rapido', category: 'transport', subcategory: 'Cabs & autos', amountPaise: rupees(85, 0.4, 35, 220) * 100, paymentMethod: 'upi', externalRef: utr() });
    if (dom === 9 || dom === 24) push(day, 17, { merchantName: 'HP Petrol Pump', description: 'POS 531234XXXXXX1234 HP PETROL PUMP', platform: 'fuel', category: 'fuel', subcategory: 'Petrol', amountPaise: rupees(1300, 0.25, 700, 2400) * 100, paymentMethod: 'debit_card' });
    if (dom === 16 && chance(0.4)) push(day, 7, { merchantName: 'IRCTC', description: 'IRCTC WEB', platform: 'irctc', category: 'transport', subcategory: 'Trains', amountPaise: rupees(1100, 0.5, 400, 2800) * 100, paymentMethod: 'net_banking' });
    // ── health, cash ───────────────────────────────────────────────────────────────────────
    if (dom === 21 && chance(0.7)) push(day, 19, { merchantName: 'Apollo Pharmacy', description: 'APOLLO PHARMACY', platform: 'medical', category: 'health', subcategory: 'Pharmacy', amountPaise: rupees(520, 0.5, 120, 1800) * 100, paymentMethod: 'upi', externalRef: utr() });
    if ((dom === 4 || dom === 19) && chance(0.7)) push(day, 12, { merchantName: 'ATM withdrawal', description: 'ATM WDL MG ROAD BANGALORE', platform: null, category: 'cash', subcategory: 'ATM withdrawal', amountPaise: pick([200_000, 300_000, 500_000]), paymentMethod: 'debit_card' });
  }

  out.sort((a, b) => a.date.toMillis() - b.date.toMillis());

  // special cases are placed relative to "now" so the current month always shows them
  const recent = (daysAgo: number, hour: number) => today.minus({ days: daysAgo }).set({ hour, minute: int(0, 59), second: int(0, 59) });
  const specials: Draft[] = [];
  const dup = recent(3, 20);
  if (dup.startOf('day') >= start) {
    specials.push({ merchantName: 'Swiggy', description: 'UPI/P2M/SWIGGY/Payment from PhonePe', platform: 'swiggy', category: 'food-delivery', subcategory: 'Restaurant orders', amountPaise: 48_900, paymentMethod: 'upi', type: 'expense', hasTime: true, date: dup, externalRef: utr() });
    specials.push({ merchantName: 'Swiggy', description: 'UPI/P2M/SWIGGY/Payment from PhonePe', platform: 'swiggy', category: 'food-delivery', subcategory: 'Restaurant orders', amountPaise: 48_900, paymentMethod: 'upi', type: 'expense', hasTime: true, date: dup.plus({ minutes: 3 }), externalRef: utr(), tags: ['possible duplicate'] });
  }
  specials.push({ merchantName: 'Amazon', description: 'AMAZON.IN — noise-cancelling headphones', platform: 'amazon', category: 'shopping', subcategory: 'Electronics', amountPaise: 3_849_900, paymentMethod: 'credit_card', type: 'expense', hasTime: true, date: recent(5, 22) });
  const merged = [...out, ...specials].filter((d) => d.date <= now).sort((a, b) => a.date.toMillis() - b.date.toMillis());

  // refunds reference an earlier purchase from the same merchant
  const refundSpecs: Array<{ platform: string; name: string; description: string; daysAfter: number }> = [
    { platform: 'zomato', name: 'Zomato', description: 'ZOMATO REFUND — order not delivered', daysAfter: 1 },
    { platform: 'amazon', name: 'Amazon', description: 'AMAZON.IN REFUND — item returned', daysAfter: 6 },
  ];
  const refunds: Draft[] = [];
  for (const spec of refundSpecs) {
    const candidates = merged.filter((m) => m.platform === spec.platform && m.type === 'expense' && m.date < today.minus({ days: 12 }) && m.date > start.plus({ days: 20 }));
    const original = candidates[Math.floor(candidates.length / 2)];
    if (!original) continue;
    refunds.push({
      merchantName: spec.name,
      description: spec.description,
      platform: spec.platform,
      category: original.category,
      subcategory: original.subcategory,
      amountPaise: original.amountPaise,
      paymentMethod: original.paymentMethod,
      type: 'refund',
      hasTime: true,
      date: original.date.plus({ days: spec.daysAfter }).set({ hour: 11, minute: int(0, 59) }),
      key: `${original.date.toMillis()}|${original.amountPaise}|${original.merchantName}`,
    });
  }
  const all = [...merged, ...refunds].sort((a, b) => a.date.toMillis() - b.date.toMillis());

  return all.map((d) => {
    const { date, key, ...rest } = d;
    const t: DemoTransaction = { ...rest, date: date.toUTC().toJSDate() };
    if (key) {
      const idx = all.findIndex((x) => x.type === 'expense' && `${x.date.toMillis()}|${x.amountPaise}|${x.merchantName}` === key);
      if (idx >= 0) t.refundOfIndex = idx;
    }
    return t;
  });
}

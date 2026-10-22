/**
 * `npm run ai:check` — tries the configured AI provider for real: one plain question, then a picture of an order-history
 * screen (drawn here, with made-up orders) read the way Settings → "Read receipt photos" reads a screenshot. It prints
 * what happened and never prints the API key.
 */
import sharp from 'sharp';
import { env } from '../src/config/env';
import { AiProviderError, extractJson, getProvider } from '../src/ai/providers';
import { readOrdersWithLlm } from '../src/ai/service';

const hints: Record<string, string> = {
  auth: 'The provider rejected the key. Check AI_API_KEY in .env (a fresh key from build.nvidia.com starts with "nvapi-").',
  rate_limited: 'The provider is rate limiting (NVIDIA\'s free tier is about 40 requests a minute). Wait a minute and try again.',
  timeout: 'No answer in time. Raise AI_TIMEOUT_MS in .env (reasoning models can be slow) or turn thinking off with AI_EXTRA_BODY.',
  bad_request: 'The provider refused the request. Check AI_MODEL is a chat model your key can use, and that AI_EXTRA_BODY suits it.',
  unavailable: 'Could not reach the provider. Check your connection and AI_BASE_URL.',
  truncated: 'The model ran out of output tokens. Turn thinking off with AI_EXTRA_BODY or raise AI_MAX_OUTPUT_TOKENS.',
  empty: 'The model answered with nothing readable. Try thinking off with AI_EXTRA_BODY.',
};
const explain = (e: unknown) => (e instanceof AiProviderError ? `${e.code}: ${hints[e.code] ?? e.message}` : e instanceof Error ? e.message : String(e));

const provider = getProvider();
if (!provider) {
  console.log('AI is off. In .env set AI_PROVIDER=openai and put your key after AI_API_KEY=, then run this again.');
  process.exit(1);
}
console.log(`provider: ${provider.id} | model: ${provider.model} | base: ${env.AI_BASE_URL ?? '(default)'} | vision: ${provider.supportsVision} | key set: ${Boolean(env.AI_API_KEY)}`);

let failed = false;

// 1. a plain question
try {
  const t0 = Date.now();
  const r = await provider.complete({ system: 'Reply with one JSON object and nothing else.', user: 'Return {"ok":true,"word":"spendly"}.', maxTokens: 300 });
  const j = extractJson(r.text) as { ok?: boolean };
  console.log(`1. text question: ${j.ok === true ? 'PASS' : 'answered, but not as asked'} (${((Date.now() - t0) / 1000).toFixed(1)}s, model ${r.model})`);
  if (j.ok !== true) failed = true;
} catch (e) {
  failed = true;
  console.log(`1. text question: FAIL — ${explain(e)}`);
}

// 2. a screenshot of an order-history screen
const ORDERS: Array<[string, string, string]> = [['Meghana Foods', '21 Oct', '742'], ['Truffles', '10 Oct', '253.50'], ['Behrouz Biryani', '2 Oct', '418']];
const rows = ORDERS.map(([name, date, total], i) => {
  const y = 150 + i * 120;
  return `<text x="40" y="${y}" font-size="34" font-weight="700">${name}</text><text x="40" y="${y + 44}" font-size="26" fill="#555">${date} · Delivered</text><text x="560" y="${y + 10}" font-size="34" font-weight="700" text-anchor="end">₹${total}</text><line x1="40" y1="${y + 70}" x2="560" y2="${y + 70}" stroke="#ddd"/>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="540"><rect width="600" height="540" fill="#fff"/><g font-family="Helvetica, Arial, sans-serif" fill="#111"><text x="40" y="70" font-size="40" font-weight="700" fill="#fc8019">Swiggy</text><text x="40" y="104" font-size="26" fill="#555">Your orders</text>${rows}</g></svg>`;
try {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  if (!provider.supportsVision) {
    console.log('2. order-history screenshot: SKIPPED — AI_VISION=false, so images are not sent. Set AI_VISION=true for a vision model.');
  } else {
    const t0 = Date.now();
    const reading = await readOrdersWithLlm({ ai: { enabled: true, readReceipts: true, shareMerchantNames: false, classifyUnknownMerchants: false, consentedAt: null } }, { mediaType: 'image/png', dataBase64: png.toString('base64') });
    if (!reading) {
      failed = true;
      console.log('2. order-history screenshot: FAIL — the model gave nothing Spendly could use (run again, or check AI_VISION and the model).');
    } else {
      const got = new Set(reading.orders.map((o) => Number(String(o.total ?? '').replace(/[^\d.]/g, ''))));
      const matched = ORDERS.filter(([, , total]) => got.has(Number(total))).length;
      const ok = matched === ORDERS.length;
      if (!ok) failed = true;
      console.log(`2. order-history screenshot: ${ok ? 'PASS' : 'PARTLY WRONG'} — read ${reading.orders.length} orders, ${matched} of ${ORDERS.length} amounts correct, app "${reading.app ?? 'not named'}" (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      for (const o of reading.orders) console.log(`     ${o.merchant ?? '?'} | ${o.date ?? '?'} | ₹${o.total ?? '?'}`);
    }
  }
} catch (e) {
  failed = true;
  console.log(`2. order-history screenshot: FAIL — ${explain(e)}`);
}

console.log(failed ? '\nAI check: something needs attention (see above).' : '\nAI check: all good. Turn on "Use AI" and "Read receipt photos" in Settings → AI & privacy to use it in the app.');
process.exit(failed ? 1 : 0);

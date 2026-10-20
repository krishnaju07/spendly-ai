import { Router } from 'express';
import { z } from 'zod';
import {
  PLATFORM_GROUPS,
  customCategorySchema,
  customPlatformSchema,
  lastMonths,
  recognize,
  ruleInputSchema,
  slugify,
  type PlatformWithStatsDto,
} from '@spendly/shared';
import { badRequest, conflict, notFound } from '../lib/errors';
import { authOf } from '../middleware/context';
import { validate } from '../middleware/validate';
import { Category, MerchantRule, Platform, Transaction } from '../models/finance';
import { patterns, platformStats, trendSeries } from '../services/analytics';
import { createClassifier, loadRules } from '../services/classify';
import { listInsights } from '../services/insights';
import { loadLookups } from '../services/lookups';
import { baselineDto, rangeDto, rangeQuery, rangesFor } from '../services/query';
import { toCategoryDto, toPlatformDto, toRuleDto, toTransactionDto } from '../services/serialize';
import { buildSearchText, classificationFrom, MACHINE_SOURCES } from '../services/transactions';

const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/) });
const idParam = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const initials = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// ── platforms ──────────────────────────────────────────────────────────────────────────────────

export const platformsRouter = Router();

/** The directory alone (no spend stats) — cheap enough to fetch once per session for logos and names. */
platformsRouter.get('/directory', async (req, res) => {
  const auth = authOf(req);
  const docs = await Platform.find({ $or: [{ userId: null }, { userId: auth.userId }], isActive: true }).lean();
  res.json({ data: docs.map(toPlatformDto) });
});

platformsRouter.get('/', validate({ query: rangeQuery }), async (req, res) => {
  const auth = authOf(req);
  const { range, baseline } = rangesFor(auth, req.valid.query);
  const lk = await loadLookups(auth.userId);
  const months = lastMonths(6, auth.tz);

  const [docs, stats, spark] = await Promise.all([
    Platform.find({ $or: [{ userId: null }, { userId: auth.userId }], isActive: true }).lean(),
    platformStats(auth, lk, range, baseline),
    Transaction.aggregate<{ _id: { platform: string | null; month: string }; netPaise: number }>([
      { $match: { userId: auth.userId, status: 'completed', type: { $in: ['expense', 'refund'] }, date: { $gte: months[0]!.from, $lt: months[months.length - 1]!.to } } },
      {
        $group: {
          _id: { platform: '$platform', month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: auth.tz } } },
          netPaise: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] } },
        },
      },
    ]),
  ]);
  const statBySlug = new Map(stats.map((s) => [s.slug, s]));
  const sparkBySlug = new Map<string | null, Map<string, number>>();
  for (const r of spark) {
    const m = sparkBySlug.get(r._id.platform) ?? new Map<string, number>();
    m.set(r._id.month, r.netPaise);
    sparkBySlug.set(r._id.platform, m);
  }
  const sparkFor = (slug: string | null) => months.map((m) => sparkBySlug.get(slug)?.get(m.key) ?? 0);

  const groupOrder = new Map<string, number>(PLATFORM_GROUPS.map((g, i) => [g, i]));
  const platforms: PlatformWithStatsDto[] = docs
    .map((d) => {
      const st = statBySlug.get(d.slug);
      return {
        ...toPlatformDto(d),
        stats: {
          netPaise: st?.netPaise ?? 0,
          grossPaise: st?.grossPaise ?? 0,
          refundsPaise: st?.refundsPaise ?? 0,
          count: st?.count ?? 0,
          avgPaise: st?.avgPaise ?? 0,
          previousNetPaise: st?.previousNetPaise ?? 0,
          changePct: st?.changePct ?? null,
          sparkline: sparkFor(d.slug),
        },
      };
    })
    .sort((a, b) => (groupOrder.get(a.group) ?? 99) - (groupOrder.get(b.group) ?? 99) || b.stats.netPaise - a.stats.netPaise || a.name.localeCompare(b.name));
  const un = statBySlug.get(null);
  res.json({
    data: {
      range: rangeDto(range),
      baseline: baselineDto(baseline),
      platforms,
      groups: [...PLATFORM_GROUPS, ...new Set(platforms.map((p) => p.group).filter((g) => !groupOrder.has(g)))],
      unassigned: { netPaise: un?.netPaise ?? 0, count: un?.count ?? 0, previousNetPaise: un?.previousNetPaise ?? 0, changePct: un?.changePct ?? null, sparkline: sparkFor(null) },
      monthLabels: months.map((m) => m.label),
    },
  });
});

platformsRouter.get('/:slug', validate({ params: slugParam, query: rangeQuery }), async (req, res) => {
  const auth = authOf(req);
  const slug = req.valid.params.slug as string;
  const doc = await Platform.findOne({ slug, $or: [{ userId: null }, { userId: auth.userId }], isActive: true }).lean();
  if (!doc) throw notFound('Platform');
  const { range, baseline } = rangesFor(auth, req.valid.query);
  const lk = await loadLookups(auth.userId);
  const months = lastMonths(12, auth.tz);
  const filters = { platform: [slug] };
  const [stats, monthly, recent, pat, insights] = await Promise.all([
    platformStats(auth, lk, range, baseline, filters),
    trendSeries(auth, { from: months[0]!.from, to: months[months.length - 1]!.to }, 'month', filters),
    Transaction.find({ userId: auth.userId, platform: slug }).sort({ date: -1 }).limit(10).lean(),
    patterns(auth, range, filters),
    listInsights(auth, lk),
  ]);
  const st = stats[0];
  const weekendNet = pat.weekday.filter((w) => w.weekday >= 6).reduce((s, w) => s + w.netPaise, 0);
  const totalNet = pat.weekday.reduce((s, w) => s + w.netPaise, 0);
  const lateNight = pat.hourly.filter((h) => h.hour >= 23 || h.hour < 4).reduce((s, h) => s + h.count, 0);
  const active = monthly.filter((m) => m.count > 0);
  res.json({
    data: {
      platform: toPlatformDto(doc),
      range: rangeDto(range),
      baseline: baselineDto(baseline),
      stats: st
        ? { netPaise: st.netPaise, grossPaise: st.grossPaise, refundsPaise: st.refundsPaise, count: st.count, avgPaise: st.avgPaise, previousNetPaise: st.previousNetPaise, changePct: st.changePct }
        : { netPaise: 0, grossPaise: 0, refundsPaise: 0, count: 0, avgPaise: 0, previousNetPaise: 0, changePct: null },
      monthly,
      ordersPerMonth: active.length ? Math.round((active.reduce((s, m) => s + m.count, 0) / active.length) * 10) / 10 : null,
      weekendSharePct: totalNet > 0 ? Math.round((weekendNet / totalNet) * 1000) / 10 : null,
      lateNightOrders: pat.timestampedShare ? lateNight : null,
      recent: recent.map((d) => toTransactionDto(d, lk)),
      insights: insights.items.filter((i) => i.evidence.scope?.platform === slug),
    },
  });
});

platformsRouter.post('/', validate({ body: customPlatformSchema }), async (req, res) => {
  const auth = authOf(req);
  const body = req.valid.body as z.output<typeof customPlatformSchema>;
  const lk = await loadLookups(auth.userId);
  if (body.category && !lk.categories.has(body.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
  let slug = `custom-${slugify(body.name) || 'platform'}`;
  for (let n = 2; await Platform.exists({ userId: auth.userId, slug }); n++) slug = `custom-${slugify(body.name)}-${n}`;
  const doc = await Platform.create({
    userId: auth.userId,
    slug,
    name: body.name,
    group: body.group,
    kind: 'brand',
    color: body.color,
    textColor: luminance(body.color) > 0.6 ? '#111111' : '#FFFFFF',
    monogram: initials(body.name),
    category: body.category ?? null,
    website: body.website ?? null,
    aliases: body.aliases,
    verification: 'custom',
    sources: { manual: true, csv: true, bankStatement: true, emailReceipts: false, officialApi: 'none', note: 'Custom platform — spending is recognised from the aliases you provide.' },
  });
  res.status(201).json({ data: toPlatformDto(doc.toObject()) });
});

platformsRouter.patch('/:slug', validate({ params: slugParam, body: customPlatformSchema.partial() }), async (req, res) => {
  const auth = authOf(req);
  const doc = await Platform.findOne({ slug: req.valid.params.slug, userId: auth.userId });
  if (!doc) throw notFound('Custom platform');
  const b = req.valid.body as Partial<z.output<typeof customPlatformSchema>>;
  if (b.name !== undefined) {
    doc.name = b.name;
    doc.monogram = initials(b.name);
  }
  if (b.group !== undefined) doc.group = b.group;
  if (b.color !== undefined) {
    doc.color = b.color;
    doc.textColor = luminance(b.color) > 0.6 ? '#111111' : '#FFFFFF';
  }
  if (b.category !== undefined) doc.category = b.category ?? null;
  if (b.aliases !== undefined) doc.aliases = b.aliases;
  if (b.website !== undefined) doc.website = b.website ?? null;
  await doc.save();
  res.json({ data: toPlatformDto(doc.toObject()) });
});

platformsRouter.delete('/:slug', validate({ params: slugParam }), async (req, res) => {
  const auth = authOf(req);
  const slug = req.valid.params.slug as string;
  const doc = await Platform.findOneAndDelete({ slug, userId: auth.userId });
  if (!doc) throw notFound('Custom platform');
  const [txns] = await Promise.all([
    Transaction.updateMany({ userId: auth.userId, platform: slug }, { $set: { platform: null } }),
    MerchantRule.updateMany({ userId: auth.userId, platform: slug }, { $set: { platform: null } }),
  ]);
  res.json({ data: { ok: true, transactionsUnassigned: txns.modifiedCount } });
});

// ── categories ─────────────────────────────────────────────────────────────────────────────────

export const categoriesRouter = Router();

categoriesRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  const docs = await Category.find({ $or: [{ userId: null }, { userId: auth.userId }], isActive: true }).lean();
  res.json({ data: docs.map(toCategoryDto) });
});

categoriesRouter.post('/', validate({ body: customCategorySchema }), async (req, res) => {
  const auth = authOf(req);
  const body = req.valid.body as z.output<typeof customCategorySchema>;
  let slug = `custom-${slugify(body.name) || 'category'}`;
  for (let n = 2; await Category.exists({ userId: auth.userId, slug }); n++) slug = `custom-${slugify(body.name)}-${n}`;
  const doc = await Category.create({ userId: auth.userId, slug, name: body.name, kind: body.kind, icon: 'Tag', slot: null, discretionary: body.discretionary, subcategories: body.subcategories });
  res.status(201).json({ data: toCategoryDto(doc.toObject()) });
});

categoriesRouter.patch('/:slug', validate({ params: slugParam, body: customCategorySchema.partial() }), async (req, res) => {
  const auth = authOf(req);
  const doc = await Category.findOne({ slug: req.valid.params.slug, userId: auth.userId });
  if (!doc) throw notFound('Custom category');
  Object.assign(doc, req.valid.body);
  await doc.save();
  res.json({ data: toCategoryDto(doc.toObject()) });
});

categoriesRouter.delete('/:slug', validate({ params: slugParam }), async (req, res) => {
  const auth = authOf(req);
  const slug = req.valid.params.slug as string;
  const doc = await Category.findOneAndDelete({ slug, userId: auth.userId });
  if (!doc) throw notFound('Custom category');
  const moved = await Transaction.updateMany({ userId: auth.userId, category: slug }, { $set: { category: null, 'classification.needsReview': true } });
  await MerchantRule.updateMany({ userId: auth.userId, category: slug }, { $set: { category: null } });
  res.json({ data: { ok: true, transactionsUncategorized: moved.modifiedCount } });
});

// ── merchant rules ─────────────────────────────────────────────────────────────────────────────

export const rulesRouter = Router();

async function assertRuleTargets(auth: ReturnType<typeof authOf>, r: { platform?: string | null; category?: string | null }) {
  const lk = await loadLookups(auth.userId);
  if (r.platform && !lk.platforms.has(r.platform)) throw badRequest('Unknown platform', undefined, 'INVALID_PLATFORM');
  if (r.category && !lk.categories.has(r.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
}

rulesRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  const rules = await MerchantRule.find({ userId: auth.userId }).sort({ priority: -1, createdAt: 1 }).lean();
  res.json({ data: rules.map(toRuleDto) });
});

rulesRouter.post('/', validate({ body: ruleInputSchema }), async (req, res) => {
  const auth = authOf(req);
  const body = req.valid.body as z.output<typeof ruleInputSchema>;
  await assertRuleTargets(auth, body);
  if ((await MerchantRule.countDocuments({ userId: auth.userId })) >= 500) throw conflict('You have reached the limit of 500 rules', undefined, 'RULE_LIMIT');
  const rule = await MerchantRule.create({ ...body, userId: auth.userId, source: 'user' });
  res.status(201).json({ data: toRuleDto(rule.toObject()) });
});

rulesRouter.patch('/:id', validate({ params: idParam, body: z.any() }), async (req, res) => {
  const auth = authOf(req);
  const rule = await MerchantRule.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!rule) throw notFound('Rule');
  // validate the merged rule as a whole so a patch can never produce an invalid combination
  const merged = ruleInputSchema.safeParse({
    name: rule.name,
    matchType: rule.matchType,
    pattern: rule.pattern,
    field: rule.field,
    platform: rule.platform,
    category: rule.category,
    subcategory: rule.subcategory,
    type: rule.type,
    priority: rule.priority,
    isActive: rule.isActive,
    ...(req.body as object),
  });
  if (!merged.success) throw badRequest(merged.error.issues[0]?.message ?? 'Invalid rule', z.flattenError(merged.error), 'VALIDATION_ERROR');
  await assertRuleTargets(auth, merged.data);
  Object.assign(rule, merged.data, { source: 'user' });
  await rule.save();
  res.json({ data: toRuleDto(rule.toObject()) });
});

rulesRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const result = await MerchantRule.deleteOne({ _id: req.valid.params.id, userId: authOf(req).userId });
  if (result.deletedCount === 0) throw notFound('Rule');
  res.json({ data: { ok: true } });
});

/** "What would my rules and the directory make of this?" — a dry run that changes nothing. */
rulesRouter.post(
  '/preview',
  validate({ body: z.object({ merchant: z.string().max(200).optional(), description: z.string().max(500).optional(), direction: z.enum(['debit', 'credit']).optional() }) }),
  async (req, res) => {
    const auth = authOf(req);
    const lk = await loadLookups(auth.userId);
    const rules = await loadRules(auth.userId);
    const rec = recognize(req.valid.body, { rules, customPlatforms: lk.customPlatforms });
    res.json({ data: { ...rec, platformName: lk.platformName(rec.platform), categoryName: lk.categoryName(rec.category) } });
  },
);

/** Re-runs classification on everything the rules (not the user) classified — e.g. after adding a rule. */
rulesRouter.post('/reapply', async (req, res) => {
  const auth = authOf(req);
  const classifier = await createClassifier(auth);
  const lk = classifier.lookups;
  const cursor = Transaction.find({ userId: auth.userId, 'classification.source': { $in: MACHINE_SOURCES }, status: 'completed' }).lean().cursor({ batchSize: 500 });
  let changed = 0;
  let scanned = 0;
  let ops: Parameters<typeof Transaction.bulkWrite>[0] = [];
  for await (const t of cursor) {
    scanned++;
    const rec = classifier.classify({ merchant: t.merchantName, description: t.description, direction: t.type === 'income' || t.type === 'refund' ? 'credit' : 'debit' });
    if (rec.source === 'default') continue;
    if (rec.platform === t.platform && rec.category === t.category && rec.subcategory === t.subcategory) continue;
    changed++;
    const next = { ...t, platform: rec.platform, category: rec.category ?? t.category, subcategory: rec.subcategory ?? t.subcategory };
    ops.push({
      updateOne: {
        filter: { _id: t._id, userId: auth.userId },
        update: { $set: { platform: next.platform, category: next.category, subcategory: next.subcategory, merchantKey: rec.merchantKey, classification: { ...classificationFrom(rec), ruleId: rec.ruleId } as never, searchText: buildSearchText(next, lk) } },
      },
    });
    if (ops.length >= 500) {
      await Transaction.bulkWrite(ops);
      ops = [];
    }
  }
  if (ops.length) await Transaction.bulkWrite(ops);
  await classifier.recordHits();
  res.json({ data: { scanned, changed } });
});


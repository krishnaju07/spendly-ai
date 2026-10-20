import { Router } from 'express';
import { z } from 'zod';
import { budgetInputSchema, contributionSchema, goalInputSchema, recurringUpdateSchema, rupeesToPaise } from '@spendly/shared';
import { badRequest, notFound } from '../lib/errors';
import { authOf } from '../middleware/context';
import { validate } from '../middleware/validate';
import { Budget, RecurringPayment, SavingsGoal } from '../models/planning';
import { budgetHistory, checkBudgetAlerts, listBudgetDtos, suggestBudgets, toBudgetDto } from '../services/budgets';
import { goalScenario, toGoalDto } from '../services/goals';
import { loadLookups } from '../services/lookups';
import { objectIdParam } from '../services/query';
import { recurringSummary, runRecurringDetection, toRecurringDto } from '../services/recurring';

// ── budgets ────────────────────────────────────────────────────────────────────────────────────

export const budgetsRouter = Router();

async function assertBudgetTargets(auth: ReturnType<typeof authOf>, b: { category?: string | null; platform?: string | null }) {
  const lk = await loadLookups(auth.userId);
  if (b.category && !lk.categories.has(b.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
  if (b.platform && !lk.platforms.has(b.platform)) throw badRequest('Unknown platform', undefined, 'INVALID_PLATFORM');
}

budgetsRouter.get('/', async (req, res) => {
  res.json({ data: await listBudgetDtos(authOf(req)) });
});

budgetsRouter.get('/suggestions', async (req, res) => {
  res.json({ data: await suggestBudgets(authOf(req)) });
});

budgetsRouter.post('/', validate({ body: budgetInputSchema }), async (req, res) => {
  const auth = authOf(req);
  const body = req.valid.body as z.output<typeof budgetInputSchema>;
  await assertBudgetTargets(auth, body);
  if ((await Budget.countDocuments({ userId: auth.userId })) >= 100) throw badRequest('You have reached the limit of 100 budgets', undefined, 'BUDGET_LIMIT');
  const doc = await Budget.create({
    userId: auth.userId,
    name: body.name,
    scope: body.scope,
    period: body.period,
    amountPaise: body.amountPaise,
    category: body.scope === 'category' ? body.category : null,
    platform: body.scope === 'platform' ? body.platform : null,
    startDate: body.period === 'custom' ? body.startDate : null,
    endDate: body.period === 'custom' ? body.endDate : null,
    alertThresholds: [...new Set(body.alertThresholds)].sort((a, b) => a - b),
    isActive: body.isActive,
  });
  void checkBudgetAlerts(auth).catch(() => undefined);
  res.status(201).json({ data: await toBudgetDto(auth, doc.toObject()) });
});

budgetsRouter.patch('/:id', validate({ params: objectIdParam, body: z.record(z.string(), z.unknown()) }), async (req, res) => {
  const auth = authOf(req);
  const doc = await Budget.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!doc) throw notFound('Budget');
  const merged = budgetInputSchema.safeParse({
    name: doc.name,
    scope: doc.scope,
    period: doc.period,
    amountPaise: doc.amountPaise,
    category: doc.category,
    platform: doc.platform,
    startDate: doc.startDate,
    endDate: doc.endDate,
    alertThresholds: doc.alertThresholds,
    isActive: doc.isActive,
    ...req.valid.body,
  });
  if (!merged.success) throw badRequest(merged.error.issues[0]?.message ?? 'Invalid budget', z.flattenError(merged.error), 'VALIDATION_ERROR');
  await assertBudgetTargets(auth, merged.data);
  const b = merged.data;
  Object.assign(doc, {
    name: b.name,
    scope: b.scope,
    period: b.period,
    amountPaise: b.amountPaise,
    category: b.scope === 'category' ? b.category : null,
    platform: b.scope === 'platform' ? b.platform : null,
    startDate: b.period === 'custom' ? b.startDate : null,
    endDate: b.period === 'custom' ? b.endDate : null,
    alertThresholds: [...new Set(b.alertThresholds)].sort((x, y) => x - y),
    isActive: b.isActive,
    lastAlert: null,
  });
  await doc.save();
  void checkBudgetAlerts(auth).catch(() => undefined);
  res.json({ data: await toBudgetDto(auth, doc.toObject()) });
});

budgetsRouter.delete('/:id', validate({ params: objectIdParam }), async (req, res) => {
  const result = await Budget.deleteOne({ _id: req.valid.params.id, userId: authOf(req).userId });
  if (result.deletedCount === 0) throw notFound('Budget');
  res.json({ data: { ok: true } });
});

budgetsRouter.get('/:id/history', validate({ params: objectIdParam }), async (req, res) => {
  const auth = authOf(req);
  const doc = await Budget.findOne({ _id: req.valid.params.id, userId: auth.userId }).lean();
  if (!doc) throw notFound('Budget');
  res.json({ data: await budgetHistory(auth, doc) });
});

// ── recurring payments ─────────────────────────────────────────────────────────────────────────

export const recurringRouter = Router();

recurringRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  const lk = await loadLookups(auth.userId);
  const summary = await recurringSummary(auth, lk);
  // first visit: detect from existing history rather than showing an empty page
  if (summary.items.length === 0 && summary.lastDetectedAt === null) {
    await runRecurringDetection(auth);
    res.json({ data: await recurringSummary(auth, lk) });
    return;
  }
  res.json({ data: summary });
});

recurringRouter.post('/detect', async (req, res) => {
  const auth = authOf(req);
  const found = await runRecurringDetection(auth);
  const lk = await loadLookups(auth.userId);
  res.json({ data: { found, ...(await recurringSummary(auth, lk)) } });
});

recurringRouter.patch('/:id', validate({ params: objectIdParam, body: recurringUpdateSchema }), async (req, res) => {
  const auth = authOf(req);
  const doc = await RecurringPayment.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!doc) throw notFound('Recurring payment');
  const b = req.valid.body as z.output<typeof recurringUpdateSchema>;
  if (b.status) doc.status = b.status;
  if (b.amountPaise !== undefined) doc.overrides.amountPaise = b.amountPaise;
  if (b.nextExpectedDate !== undefined) doc.overrides.nextExpectedDate = b.nextExpectedDate ? new Date(`${b.nextExpectedDate}T12:00:00Z`) : null;
  if (b.reminderDaysBefore !== undefined) doc.reminderDaysBefore = b.reminderDaysBefore;
  await doc.save();
  const lk = await loadLookups(auth.userId);
  res.json({ data: toRecurringDto(doc.toObject(), lk, auth.tz) });
});

// ── savings goals ──────────────────────────────────────────────────────────────────────────────

export const goalsRouter = Router();

goalsRouter.get('/', async (req, res) => {
  const auth = authOf(req);
  const goals = await SavingsGoal.find({ userId: auth.userId }).sort({ targetDate: 1 }).lean();
  res.json({ data: goals.map((g) => toGoalDto(auth, g)) });
});

goalsRouter.post('/', validate({ body: goalInputSchema }), async (req, res) => {
  const auth = authOf(req);
  const doc = await SavingsGoal.create({ ...(req.valid.body as z.output<typeof goalInputSchema>), userId: auth.userId });
  res.status(201).json({ data: toGoalDto(auth, doc.toObject()) });
});

goalsRouter.patch('/:id', validate({ params: objectIdParam, body: goalInputSchema.partial() }), async (req, res) => {
  const auth = authOf(req);
  const doc = await SavingsGoal.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!doc) throw notFound('Goal');
  Object.assign(doc, req.valid.body);
  await doc.save();
  res.json({ data: toGoalDto(auth, doc.toObject()) });
});

goalsRouter.delete('/:id', validate({ params: objectIdParam }), async (req, res) => {
  const result = await SavingsGoal.deleteOne({ _id: req.valid.params.id, userId: authOf(req).userId });
  if (result.deletedCount === 0) throw notFound('Goal');
  res.json({ data: { ok: true } });
});

goalsRouter.post('/:id/contributions', validate({ params: objectIdParam, body: contributionSchema }), async (req, res) => {
  const auth = authOf(req);
  const doc = await SavingsGoal.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!doc) throw notFound('Goal');
  const b = req.valid.body as z.output<typeof contributionSchema>;
  doc.contributions.push({ amountPaise: b.amountPaise, date: b.date ?? new Date().toISOString().slice(0, 10), note: b.note } as never);
  await doc.save();
  res.status(201).json({ data: toGoalDto(auth, doc.toObject()) });
});

goalsRouter.delete('/:id/contributions/:cid', validate({ params: objectIdParam.extend({ cid: z.string().regex(/^[a-f\d]{24}$/i) }) }), async (req, res) => {
  const auth = authOf(req);
  const doc = await SavingsGoal.findOne({ _id: req.valid.params.id, userId: auth.userId });
  if (!doc) throw notFound('Goal');
  const before = doc.contributions.length;
  doc.contributions = doc.contributions.filter((c) => c._id.toString() !== req.valid.params.cid) as typeof doc.contributions;
  if (doc.contributions.length === before) throw notFound('Contribution');
  await doc.save();
  res.json({ data: toGoalDto(auth, doc.toObject()) });
});

const scenarioQuery = z.object({
  category: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  reducePct: z.coerce.number().min(1).max(100).default(20),
  plannedMonthly: z.string().max(20).optional(),
});

goalsRouter.get('/:id/scenario', validate({ params: objectIdParam, query: scenarioQuery }), async (req, res) => {
  const auth = authOf(req);
  const doc = await SavingsGoal.findOne({ _id: req.valid.params.id, userId: auth.userId }).lean();
  if (!doc) throw notFound('Goal');
  const q = req.valid.query as z.output<typeof scenarioQuery>;
  const lk = await loadLookups(auth.userId);
  if (!lk.categories.has(q.category)) throw badRequest('Unknown category', undefined, 'INVALID_CATEGORY');
  let planned: number | undefined;
  if (q.plannedMonthly) {
    try {
      planned = rupeesToPaise(q.plannedMonthly);
    } catch {
      throw badRequest('plannedMonthly is not a valid amount');
    }
  }
  res.json({ data: await goalScenario(auth, doc, { category: q.category, reducePct: q.reducePct, plannedMonthlyPaise: planned }) });
});

import { Router } from 'express';
import { z } from 'zod';
import {
  aiChatSchema,
  buildLexicon,
  parsePeriod,
  parseQuestion,
  queryPlanSchema,
  type QueryPlan,
} from '@spendly/shared';
import { authOf } from '../middleware/context';
import { aiLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { AIInsight } from '../models/planning';
import { aiGate, aiStatus, narrate, planWithLlm } from '../ai/service';
import { notFound } from '../lib/errors';
import { answerPlan, factsForLlm } from '../services/coach';
import { listInsights } from '../services/insights';
import { loadLookups } from '../services/lookups';
import { objectIdParam } from '../services/query';

export const aiRouter = Router();

aiRouter.get('/status', (req, res) => {
  res.json({ data: aiStatus(authOf(req).prefs) });
});

aiRouter.get('/insights', async (req, res) => {
  const auth = authOf(req);
  res.json({ data: await listInsights(auth, await loadLookups(auth.userId)) });
});

aiRouter.post('/insights/refresh', aiLimiter, async (req, res) => {
  const auth = authOf(req);
  res.json({ data: await listInsights(auth, await loadLookups(auth.userId), { force: true }) });
});

aiRouter.patch('/insights/:id', validate({ params: objectIdParam, body: z.object({ status: z.enum(['active', 'dismissed']) }) }), async (req, res) => {
  const result = await AIInsight.updateOne({ _id: req.valid.params.id, userId: authOf(req).userId }, { $set: { status: req.valid.body.status } });
  if (result.matchedCount === 0) throw notFound('Insight');
  res.json({ data: { ok: true } });
});

/**
 * A follow-up like "and last month?" or "what about Swiggy?" reuses the previous plan with the new
 * period or the new platform/category swapped in.
 */
function followUp(
  previous: QueryPlan,
  message: string,
  lexicon: ReturnType<typeof buildLexicon>,
  now: Date,
  tz: string,
): QueryPlan | null {
  const period = parsePeriod(message, now, tz);
  if (period && 'period' in previous) return { ...previous, period } as QueryPlan;
  const asSpend = parseQuestion(`how much did i spend on ${message}`, lexicon, { now, tz }).plan;
  if (asSpend.intent === 'spend_total' && asSpend.filter.label && asSpend.filter.label !== 'everything' && 'filter' in previous) {
    return { ...previous, filter: asSpend.filter } as QueryPlan;
  }
  return null;
}

aiRouter.post('/chat', aiLimiter, validate({ body: aiChatSchema }), async (req, res) => {
  const auth = authOf(req);
  const { message, previousPlan } = req.valid.body as z.output<typeof aiChatSchema>;
  const now = new Date();
  const lk = await loadLookups(auth.userId);
  const lexicon = buildLexicon({
    platforms: [...lk.platforms.values()].filter((p) => p.isCustom).map((p) => ({ slug: p.slug, name: p.name, terms: [p.name.toLowerCase()] })),
    categories: [...lk.categories.values()].filter((c) => c.isCustom).map((c) => ({ slug: c.slug, name: c.name, terms: [c.name.toLowerCase()] })),
  });

  const parsed = parseQuestion(message, lexicon, { now, tz: auth.tz });
  let plan = parsed.plan;
  const assumptions = [...parsed.assumptions];

  if (parsed.confidence === 'low') {
    const prev = queryPlanSchema.safeParse(previousPlan);
    const carried = prev.success ? followUp(prev.data, message, lexicon, now, auth.tz) : null;
    if (carried) {
      plan = carried;
      assumptions.length = 0;
      assumptions.push('Treated as a follow-up to your previous question.');
    } else if (aiGate(auth.prefs, 'parseQuestions').allowed) {
      const viaLlm = await planWithLlm({ prefs: auth.prefs, lookups: lk, question: message, today: now.toISOString().slice(0, 10) });
      if (viaLlm) {
        plan = viaLlm;
        assumptions.push('Your question was interpreted with the AI provider you enabled; the figures below come from your data, not from the AI.');
      }
    }
  }

  const answer = await answerPlan(auth, lk, message, plan, assumptions, now);

  if (plan.intent !== 'help') {
    const gate = aiGate(auth.prefs, 'narrate');
    if (gate.allowed) {
      const result = await narrate({ prefs: auth.prefs, lookups: lk, question: message, facts: factsForLlm(answer) });
      if (result.ok) answer.explanation = { source: 'llm', text: result.text, validation: { passed: true, issues: [] } };
      else {
        answer.explanation.validation = {
          passed: false,
          issues: [
            result.reason === 'unverified_numbers'
              ? 'The AI wording was discarded because it contained a figure that is not in your verified data.'
              : `AI wording unavailable (${result.reason.replace(/_/g, ' ')}); showing the verified answer.`,
          ],
        };
      }
    }
  }
  res.json({ data: answer });
});

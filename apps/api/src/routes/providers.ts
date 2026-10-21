import { Router } from 'express';
import { z } from 'zod';
import { isProviderId, type ProviderId } from '@spendly/shared';
import { AppError, notFound } from '../lib/errors';
import { authOf } from '../middleware/context';
import { providerLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { disconnect, finishConnect, listProviders, startConnect, syncProvider } from '../services/providers';

export const providersRouter = Router();

const params = z.object({ id: z.string().refine(isProviderId, 'Unknown service') });
const idOf = (req: { valid: { params?: { id: string } } }) => (req.valid.params?.id ?? '') as ProviderId;

providersRouter.get('/', async (req, res) => {
  res.json({ data: await listProviders(authOf(req)) });
});

/** Starts the sign-in: answers with the address of the service's own page, where the person enters their phone number and OTP. */
providersRouter.post('/:id/connect', providerLimiter, validate({ params }), async (req, res) => {
  res.json({ data: { url: await startConnect(authOf(req), idOf(req)) } });
});

const callbackQuery = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(100).optional() });

/** Where the service sends the person back to. It always ends in a redirect into Settings, saying how it went. */
providersRouter.get('/:id/callback', validate({ params, query: callbackQuery }), async (req, res) => {
  const id = idOf(req);
  const q = req.valid.query as z.output<typeof callbackQuery>;
  const back = (result: 'ok' | 'denied' | 'error') => res.redirect(`/settings?tab=tracking&link=${id}:${result}`);
  if (q.error) return back('denied');
  if (!q.code || !q.state) return back('error');
  try {
    await finishConnect(authOf(req), id, { code: q.code, state: q.state });
    back('ok');
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    back('error');
  }
});

providersRouter.post('/:id/sync', providerLimiter, validate({ params }), async (req, res) => {
  res.json({ data: await syncProvider(authOf(req), idOf(req)) });
});

providersRouter.delete('/:id', validate({ params }), async (req, res) => {
  if (!isProviderId(idOf(req))) throw notFound('Service');
  await disconnect(authOf(req), idOf(req));
  res.json({ data: { ok: true } });
});

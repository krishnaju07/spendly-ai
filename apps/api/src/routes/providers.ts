import { Router } from 'express';
import { z } from 'zod';
import { isProviderId, type ProviderId } from '@spendly/shared';
import { notFound } from '../lib/errors';
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

const completeBody = z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) });

/**
 * The page the service sends the person back to (Spendly's own /callback) hands over what it was given. A POST, so
 * a link someone is tricked into opening cannot link an account; it also needs the signed-in session and its token.
 */
providersRouter.post('/complete', validate({ body: completeBody }), async (req, res) => {
  const { code, state } = req.valid.body as z.output<typeof completeBody>;
  res.json({ data: { provider: await finishConnect(authOf(req), { code, state }) } });
});

const syncBody = z.object({ preview: z.boolean().optional() });

providersRouter.post('/:id/sync', providerLimiter, validate({ params, body: syncBody }), async (req, res) => {
  const { preview } = req.valid.body as z.output<typeof syncBody>;
  res.json({ data: await syncProvider(authOf(req), idOf(req), { preview }) });
});

providersRouter.delete('/:id', validate({ params }), async (req, res) => {
  if (!isProviderId(idOf(req))) throw notFound('Service');
  await disconnect(authOf(req), idOf(req));
  res.json({ data: { ok: true } });
});

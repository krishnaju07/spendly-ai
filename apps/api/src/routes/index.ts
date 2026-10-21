import { Router } from 'express';
import { dbReady } from '../db';
import { requireAuth } from '../middleware/auth';
import { aiRouter } from './ai';
import { accountRoutes } from './account-routes';
import { analyticsRouter } from './analytics';
import { authRouter } from './auth';
import { categoriesRouter, platformsRouter, rulesRouter } from './catalog';
import { dashboardRouter } from './dashboard';
import { importsRouter } from './imports';
import { providersRouter } from './providers';
import { budgetsRouter, goalsRouter, recurringRouter } from './planning';
import { reportsRouter } from './reports';
import { transactionsRouter } from './transactions';

export const v1 = Router();

v1.get('/health', async (_req, res) => {
  const db = await dbReady();
  res.status(db ? 200 : 503).json({ data: { status: db ? 'ok' : 'degraded', database: db ? 'up' : 'down', time: new Date().toISOString() } });
});

v1.use('/auth', authRouter);

// everything below belongs to a signed-in user and is scoped to them
v1.use(requireAuth);
v1.use('/dashboard', dashboardRouter);
v1.use('/transactions', transactionsRouter);
v1.use('/imports', importsRouter);
v1.use('/platforms', platformsRouter);
v1.use('/categories', categoriesRouter);
v1.use('/rules', rulesRouter);
v1.use('/analytics', analyticsRouter);
v1.use('/ai', aiRouter);
v1.use('/budgets', budgetsRouter);
v1.use('/savings-goals', goalsRouter);
v1.use('/recurring-payments', recurringRouter);
v1.use('/reports', reportsRouter);
v1.use('/integrations/providers', providersRouter);
v1.use(accountRoutes);

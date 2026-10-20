import { Router } from 'express';
import { integrationsRouter, notificationsRouter, settingsRouter } from './account';

export const accountRoutes = Router();
accountRoutes.use('/notifications', notificationsRouter);
accountRoutes.use('/settings', settingsRouter);
accountRoutes.use('/integrations', integrationsRouter);

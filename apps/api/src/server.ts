import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './db';
import { startWorker, stopWorker } from './imports/worker';
import { logger } from './lib/logger';
import { purgeExpiredDemos } from './services/account';
import { seedSystemCatalog } from './services/catalog-seed';

async function main() {
  await connectDb();
  await seedSystemCatalog();
  await purgeExpiredDemos().catch((e) => logger.warn({ err: e }, 'demo purge failed'));

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, ai: env.AI_PROVIDER }, `Spendly API listening on http://localhost:${env.PORT}`);
  });

  if (env.WORKER_ENABLED) startWorker();
  const sweep = setInterval(() => void purgeExpiredDemos().catch(() => undefined), 3_600_000);
  sweep.unref();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopWorker();
    clearInterval(sweep);
    server.close(() => void disconnectDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start');
  process.exit(1);
});

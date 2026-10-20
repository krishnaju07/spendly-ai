/**
 * Zero-install development database: a real mongod (downloaded once by mongodb-memory-server),
 * persisted under .data/mongo so data survives restarts. For production use a managed MongoDB
 * (Atlas) or the docker-compose service instead.
 */
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = path.join(root, '.data/mongo');
mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.MONGO_PORT ?? 27017);

const inUse = await new Promise<boolean>((resolve) => {
  const probe = net.createConnection({ port, host: '127.0.0.1' });
  probe.once('connect', () => (probe.destroy(), resolve(true)));
  probe.once('error', () => resolve(false));
});

if (inUse) {
  console.log(`[db] Something is already listening on port ${port} — assuming it is MongoDB and leaving it alone.`);
  setInterval(() => undefined, 1 << 30);
} else {
  const server = await MongoMemoryServer.create({ instance: { port, dbPath, storageEngine: 'wiredTiger', dbName: 'spendly' } });
  console.log(`[db] MongoDB ready at ${server.getUri()} (data in ${path.relative(process.cwd(), dbPath) || dbPath})`);
  const stop = async () => {
    await server.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

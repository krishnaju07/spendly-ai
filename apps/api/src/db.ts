import mongoose from 'mongoose';
import { env } from './config/env';
import { logger } from './lib/logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Email + password sign-in was replaced by mobile numbers. Its unique email index would now reject
 * every second account (the field is gone, so all of them look like `email: null`), so remove it.
 */
async function dropRetiredIndexes(): Promise<void> {
  try {
    await mongoose.connection.collection('users').dropIndex('email_1');
    logger.info('Removed the retired users.email index');
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 27 && code !== 26) throw error; // IndexNotFound / NamespaceNotFound: nothing to remove
  }
}

/** Connects with retries so the API can start before the database is ready (dev, containers). */
export async function connectDb(uri: string = env.MONGODB_URI, maxAttempts = 30): Promise<void> {
  mongoose.set('strictQuery', true);
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000, autoIndex: true, maxPoolSize: 20 });
      logger.info('Connected to MongoDB');
      await dropRetiredIndexes();
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      logger.warn({ attempt, maxAttempts }, 'MongoDB not reachable yet — retrying');
      await sleep(2000);
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export async function dbReady(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}

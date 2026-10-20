import { logger } from '../lib/logger';
import { Category, Platform } from '../models/finance';
import { systemCategoryDocs, systemPlatformDocs } from './serialize';

/** Keeps the built-in directory in the database in step with the code. Idempotent; safe on every boot. */
export async function seedSystemCatalog(): Promise<void> {
  const platformOps = systemPlatformDocs().map((doc) => ({
    updateOne: { filter: { userId: null, slug: doc.slug }, update: { $set: doc }, upsert: true },
  }));
  const categoryOps = systemCategoryDocs().map((doc) => ({
    updateOne: { filter: { userId: null, slug: doc.slug }, update: { $set: doc }, upsert: true },
  }));
  const [p, c] = await Promise.all([Platform.bulkWrite(platformOps), Category.bulkWrite(categoryOps)]);
  logger.info({ platforms: p.upsertedCount + p.modifiedCount + p.matchedCount, categories: c.upsertedCount + c.modifiedCount + c.matchedCount }, 'Catalog synced');
}

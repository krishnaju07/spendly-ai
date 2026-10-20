import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReadStream } from 'node:fs';
import type { Types } from 'mongoose';
import { env } from '../config/env';

/**
 * Private file storage. Files live outside any web root under random names; the original filename
 * is only ever metadata. Every read goes through an authenticated, ownership-checked route.
 * This is the single place to swap in S3/GCS.
 */

const SAFE_EXT = /^[a-z0-9]{1,5}$/;

function resolveKey(key: string): string {
  const full = path.resolve(env.uploadDir, key);
  if (!full.startsWith(env.uploadDir + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function saveFile(userId: Types.ObjectId, data: Buffer, ext: string): Promise<string> {
  const safeExt = SAFE_EXT.test(ext) ? ext : 'bin';
  const key = `${userId.toString()}/${randomUUID()}.${safeExt}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, data, { mode: 0o600 });
  return key;
}

export function openFile(key: string): ReadStream {
  return createReadStream(resolveKey(key));
}

export async function readFileBuffer(key: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(resolveKey(key));
}

export async function deleteFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  await rm(resolveKey(key), { force: true });
}

/** Removes everything stored for a user (account deletion). */
export async function deleteUserFiles(userId: Types.ObjectId): Promise<void> {
  await rm(path.join(env.uploadDir, userId.toString()), { recursive: true, force: true });
}

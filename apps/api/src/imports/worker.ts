import type { Types } from 'mongoose';
import { logger } from '../lib/logger';
import { ImportJob } from '../models/imports';
import { importJob, processJob, rollbackJob } from './pipeline';

/**
 * A small Mongo-backed job queue. Jobs are claimed atomically (so several API instances can share
 * one database), progress is persisted after every batch, and a job whose worker died is requeued
 * and resumes from its last cursor. Swap this for BullMQ/Redis when you outgrow it — the handlers
 * in pipeline.ts do not care who calls them.
 */

type Task = 'process' | 'import' | 'rollback';
const STALE_LOCK_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

let running = false;
let timer: NodeJS.Timeout | null = null;

export async function enqueue(jobId: Types.ObjectId, task: Task): Promise<void> {
  const status = task === 'process' ? 'queued' : task === 'import' ? 'importing' : 'importing';
  await ImportJob.updateOne(
    { _id: jobId },
    { $set: { 'queue.task': task, 'queue.state': 'queued', 'queue.lockedAt': null, 'queue.attempts': 0, status, error: null } },
  );
  kick();
}

async function claim() {
  return ImportJob.findOneAndUpdate(
    { 'queue.state': 'queued' },
    { $set: { 'queue.state': 'running', 'queue.lockedAt': new Date() }, $inc: { 'queue.attempts': 1 } },
    { sort: { updatedAt: 1 }, returnDocument: 'after' },
  );
}

async function reapStale(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  await ImportJob.updateMany({ 'queue.state': 'running', 'queue.lockedAt': { $lt: cutoff }, 'queue.attempts': { $lt: MAX_ATTEMPTS } }, { $set: { 'queue.state': 'queued' } });
  await ImportJob.updateMany(
    { 'queue.state': 'running', 'queue.lockedAt': { $lt: cutoff }, 'queue.attempts': { $gte: MAX_ATTEMPTS } },
    { $set: { 'queue.state': 'idle', status: 'failed', error: 'Processing was interrupted several times. Use Retry to continue from where it stopped.' } },
  );
}

/** Processes one queued job. Returns true if a job was handled. */
export async function runOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const task = job.queue.task as Task | null;
  try {
    if (task === 'process') await processJob(job._id);
    else if (task === 'import') await importJob(job._id);
    else if (task === 'rollback') await rollbackJob(job._id);
  } catch (error) {
    const message = (error as Error).message || 'Unknown error';
    logger.error({ err: error, jobId: job._id.toString(), task }, 'import job failed');
    await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'failed', error: message.slice(0, 500), 'queue.state': 'idle', 'progress.phase': 'failed' } });
  } finally {
    // handlers set the queue idle on success; this guards against an early return
    await ImportJob.updateOne({ _id: job._id, 'queue.state': 'running' }, { $set: { 'queue.state': 'idle' } });
  }
  return true;
}

/** Drains the queue; used by the worker loop and awaited by anything that needs a result right now. */
export async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await reapStale();
    while (await runOnce()) {
      /* keep going until nothing is queued */
    }
  } finally {
    running = false;
  }
}

export function kick(): void {
  setImmediate(() => void drain().catch((e) => logger.error({ err: e }, 'worker drain failed')));
}

export function startWorker(): void {
  if (timer) return;
  timer = setInterval(() => void drain().catch((e) => logger.error({ err: e }, 'worker poll failed')), 2000);
  timer.unref();
  kick();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

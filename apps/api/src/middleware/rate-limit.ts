import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

const handler = (windowMs: number) => (_req: Request, res: Response) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment and try again.',
      details: { retryAfterSeconds: Math.ceil(windowMs / 1000) },
    },
  });
};

const make = (windowMs: number, limit: number, perUser = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    keyGenerator: (req) => (perUser && req.auth ? `u:${req.auth.userId.toString()}` : ipKeyGenerator(req.ip ?? '')),
    handler: handler(windowMs),
  });

/** Everything under /api. Generous: a dashboard fires a handful of parallel requests per view. */
export const apiLimiter = make(60_000, 600);
/** Asking for a sign-in code costs an SMS, so it is the tightest limit (a per-number cap applies as well). */
export const otpRequestLimiter = make(15 * 60_000, 10);
/** Checking a code. Each code also has its own attempt limit. */
export const otpVerifyLimiter = make(15 * 60_000, 30);
/** Demo workspaces are cheap to make but not free: stop them being spammed. */
export const demoLimiter = make(60 * 60_000, 12);
/** Chat and insight generation: the expensive endpoints. Per user, not per IP. */
export const aiLimiter = make(60_000, 20, true);
export const uploadLimiter = make(60 * 60_000, 40, true);
export const exportLimiter = make(60 * 60_000, 30, true);

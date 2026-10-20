import { Router } from 'express';
import { z } from 'zod';
import {
  OTP_LENGTH,
  otpRequestSchema,
  otpVerifySchema,
  type AuthConfigDto,
  type AuthResultDto,
  type MeDto,
} from '@spendly/shared';
import { env } from '../config/env';
import { csrfTokenFor, sha256 } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { clearSessionCookies, requireAuth, SESSION_COOKIE, startSession } from '../middleware/auth';
import { authOf } from '../middleware/context';
import { demoLimiter, otpRequestLimiter, otpVerifyLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { Session, User, UserPreference } from '../models/account';
import { createDemoWorkspace, toPreferencesDto, toUserDto } from '../services/account';
import { checkCode, holdCode, requestCode, spendCode } from '../services/otp';
import { isLoopback, smsDelivery } from '../services/sms';

export const authRouter = Router();

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/** How sign-in codes reach people here, so the sign-in screen can be honest before anyone types a number. */
authRouter.get('/config', (req, res) => {
  const body: AuthConfigDto = {
    otp: { delivery: smsDelivery(isLoopback(req.ip)), length: OTP_LENGTH, resendSeconds: env.OTP_RESEND_SECONDS, expiresMinutes: env.OTP_TTL_MINUTES },
  };
  res.json({ data: body });
});

/** Texts a code to a mobile number. The same answer whether or not the number has an account. */
authRouter.post('/otp/request', otpRequestLimiter, validate({ body: otpRequestSchema }), async (req, res) => {
  const { phone } = req.valid.body as z.output<typeof otpRequestSchema>;
  res.json({ data: await requestCode(phone, isLoopback(req.ip)) });
});

/**
 * Signs in with the texted code — and creates the account if the number is new. A right code for a
 * number with no account and no name answers `needs_name` (and stays valid a few minutes) so the
 * person can add their name and send the same code again.
 */
authRouter.post('/otp/verify', otpVerifyLimiter, validate({ body: otpVerifySchema }), async (req, res) => {
  const { phone, otp, name } = req.valid.body as z.output<typeof otpVerifySchema>;
  const challenge = await checkCode(phone, otp);

  let user = await User.findOne({ phone });
  if (!user && !name) {
    await holdCode(challenge);
    const body: AuthResultDto = { status: 'needs_name' };
    res.json({ data: body });
    return;
  }

  await spendCode(challenge);
  let isNew = false;
  if (!user) {
    try {
      user = await User.create({ phone, name: name as string });
      isNew = true;
    } catch (error) {
      // two tabs finishing sign-up at the same moment: the number now exists, so just sign in to it
      if (!isDuplicateKey(error)) throw error;
      user = await User.findOne({ phone });
      if (!user) throw error;
    }
  }
  user.lastLoginAt = new Date();
  await user.save();
  const prefs = await UserPreference.findOneAndUpdate({ userId: user._id }, { $setOnInsert: { userId: user._id } }, { upsert: true, returnDocument: 'after' });
  const { csrfToken } = await startSession(req, res, user);
  const body: AuthResultDto = { status: 'signed_in', isNew, user: toUserDto(user.toObject()), preferences: toPreferencesDto(prefs.toObject()), csrfToken };
  res.status(isNew ? 201 : 200).json({ data: body });
});

/** Starts an isolated, clearly-labelled demo workspace. Nothing here touches any real account. */
authRouter.post('/demo', demoLimiter, async (req, res) => {
  const user = await createDemoWorkspace();
  const prefs = await UserPreference.findOne({ userId: user._id }).lean();
  if (!prefs) throw new AppError(500, 'DEMO_FAILED', 'Could not prepare the demo workspace');
  const { csrfToken } = await startSession(req, res, user);
  const body: MeDto = { user: toUserDto(user), preferences: toPreferencesDto(prefs), csrfToken };
  res.status(201).json({ data: body });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) await Session.deleteOne({ tokenHash: sha256(token) });
  clearSessionCookies(res);
  res.json({ data: { ok: true } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const a = authOf(req);
  const body: MeDto = { user: toUserDto(a.user), preferences: toPreferencesDto(a.prefs), csrfToken: csrfTokenFor(a.sessionTokenHash) };
  res.json({ data: body });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const a = authOf(req);
  const sessions = await Session.find({ userId: a.userId }).sort({ lastSeenAt: -1 }).lean();
  res.json({
    data: sessions.map((s) => ({
      id: s._id.toString(),
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s._id.equals(a.sessionId),
    })),
  });
});

authRouter.delete('/sessions/:id', requireAuth, validate({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }) }), async (req, res) => {
  const a = authOf(req);
  const result = await Session.deleteOne({ _id: req.valid.params.id, userId: a.userId });
  if (result.deletedCount === 0) throw notFound('Session');
  res.json({ data: { ok: true } });
});

import { randomInt } from 'node:crypto';
import type { Types } from 'mongoose';
import { OTP_LENGTH, type OtpRequestResultDto } from '@spendly/shared';
import { env } from '../config/env';
import { otpDigest, safeEqual } from '../lib/crypto';
import { AppError, unavailable } from '../lib/errors';
import { OtpChallenge } from '../models/account';
import { matchTotp } from '../lib/totp';
import { getSmsProvider, usesAuthenticator } from './sms';

const HOUR_MS = 3_600_000;
/** How long a correct code stays usable while someone with a brand-new number types their name. */
const HOLD_MS = 10 * 60_000;

const expired = () => new AppError(400, 'CODE_EXPIRED', 'That code has expired. Ask for a new one.');

/**
 * Texts a fresh code to `phone`. The answer never depends on whether the number already has an
 * account, so this cannot be used to find out who uses Spendly. Spacing and an hourly cap per
 * number stop it being used to flood someone's phone.
 */
export async function requestCode(phone: string, viaLoopback: boolean): Promise<OtpRequestResultDto> {
  const authenticator = usesAuthenticator(viaLoopback);
  const provider = getSmsProvider(viaLoopback);
  if (!provider && !authenticator) throw unavailable('Sign-in codes by SMS are not set up on this server yet.', 'SMS_NOT_CONFIGURED');
  const now = Date.now();

  const latest = await OtpChallenge.findOne({ phone }).sort({ createdAt: -1 }).select('createdAt').lean();
  if (latest) {
    const wait = Math.ceil((latest.createdAt.getTime() + env.OTP_RESEND_SECONDS * 1000 - now) / 1000);
    if (wait > 0) {
      throw new AppError(429, 'CODE_COOLDOWN', `Please wait ${wait} second${wait === 1 ? '' : 's'} before asking for another code.`, { retryAfterSeconds: wait });
    }
  }
  const sent = await OtpChallenge.countDocuments({ phone, createdAt: { $gt: new Date(now - HOUR_MS) } });
  if (sent >= env.OTP_MAX_SENDS_PER_HOUR) {
    throw new AppError(429, 'CODE_LIMIT', 'Too many codes were asked for this number. Please try again in about an hour.', { retryAfterSeconds: 3600 });
  }

  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  // Nothing is sent. The answer is the same for every number (so this cannot reveal who the owners are), and only an
  // owner's challenge is checked against the authenticator; anyone else's holds a random code nobody has seen.
  const method = authenticator && env.ownerPhones.includes(phone) ? 'authenticator' : 'sms';
  const challenge = await OtpChallenge.create({ phone, codeHash: otpDigest(phone, code), method, expiresAt: new Date(now + env.OTP_TTL_MINUTES * 60_000) });
  try {
    if (provider) await provider.send(phone, code);
  } catch (error) {
    // a code that never went out should not count against the number's cap or delay the next try
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }
  // only the newest code works
  await OtpChallenge.updateMany({ phone, _id: { $ne: challenge._id }, consumedAt: null }, { $set: { consumedAt: new Date(now) } });
  return {
    resendInSeconds: env.OTP_RESEND_SECONDS,
    expiresInSeconds: env.OTP_TTL_MINUTES * 60,
    ...(provider?.mode === 'dev' ? { devCode: code } : {}),
  };
}

/**
 * Whether `otp` is right for this challenge: the texted code's hash, or for an owner the app's current code.
 * An app code is good for one sign-in only: if another challenge for this number already signed in with the
 * same 30-second step, someone replaying a code they saw over a shoulder gets nowhere.
 */
async function codeIsRight(challenge: { _id: Types.ObjectId; codeHash: string; method?: string }, phone: string, otp: string): Promise<boolean> {
  if (challenge.method !== 'authenticator' || !env.ownerTotpKey) return safeEqual(challenge.codeHash, otpDigest(phone, otp));
  const step = matchTotp(env.ownerTotpKey, otp);
  if (step === null) return false;
  if (await OtpChallenge.exists({ phone, _id: { $ne: challenge._id }, totpStep: step })) return false;
  await OtpChallenge.updateOne({ _id: challenge._id }, { $set: { totpStep: step } });
  return true;
}

/**
 * Checks a code against the newest live one for `phone` and returns its id. Every check counts as
 * an attempt *before* the comparison, so parallel guesses cannot get past the limit. The code is not
 * used up here — call `spendCode` once the sign-in is certain.
 */
export async function checkCode(phone: string, otp: string): Promise<Types.ObjectId> {
  const now = new Date();
  const live = await OtpChallenge.findOne({ phone, consumedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).select('_id').lean();
  if (!live) throw expired();

  const tried = await OtpChallenge.findOneAndUpdate(
    { _id: live._id, consumedAt: null, attempts: { $lt: env.OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!tried) throw new AppError(429, 'CODE_LOCKED', 'Too many wrong codes. Ask for a new one.');

  if (!(await codeIsRight(tried, phone, otp))) {
    const left = env.OTP_MAX_ATTEMPTS - tried.attempts;
    if (left <= 0) await OtpChallenge.updateOne({ _id: tried._id }, { $set: { consumedAt: now } });
    throw new AppError(400, 'INVALID_CODE', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Ask for a new one.', {
      attemptsLeft: Math.max(0, left),
    });
  }
  return tried._id;
}

/** Uses up a correct code. Atomic, so one code can start only one session even if sent twice. */
export async function spendCode(id: Types.ObjectId): Promise<void> {
  const result = await OtpChallenge.updateOne({ _id: id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  if (result.modifiedCount !== 1) throw expired();
}

/** Keeps a correct code alive a little longer (for a new person to add their name). */
export async function holdCode(id: Types.ObjectId): Promise<void> {
  await OtpChallenge.updateOne({ _id: id, consumedAt: null }, { $set: { expiresAt: new Date(Date.now() + HOLD_MS) } });
}

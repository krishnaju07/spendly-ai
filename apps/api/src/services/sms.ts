import { maskPhone } from '@spendly/shared';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Delivers sign-in codes. Providers are chosen with SMS_PROVIDER and configured only through the
 * environment — no credentials live in code. `dev` providers never reach a phone: they exist so the
 * app can be tried locally, and the sign-in screen says so when one is active.
 */
export interface SmsProvider {
  id: 'console' | 'twilio' | 'webhook';
  mode: 'dev' | 'sms';
  send(to: string, code: string): Promise<void>;
}

const messageFor = (code: string) =>
  `${code} is your Spendly sign-in code. It expires in ${env.OTP_TTL_MINUTES} minutes. Never share it with anyone.`;

const sendFailed = () => new AppError(502, 'SMS_SEND_FAILED', 'We could not send the code just now. Please try again in a minute.');

/** Runs a provider call with the shared timeout; anything that goes wrong becomes one safe error (details stay in the log). */
async function post(provider: string, url: string, init: RequestInit): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(env.SMS_TIMEOUT_MS) });
  } catch (error) {
    logger.error({ provider, reason: error instanceof Error ? error.name : 'unknown' }, 'Could not reach the SMS provider');
    throw sendFailed();
  }
  if (res.ok) return;
  // provider error bodies can echo the destination number, so only the status and error code are kept
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  logger.error({ provider, status: res.status, providerCode: typeof body?.code === 'number' || typeof body?.code === 'string' ? body.code : undefined }, 'The SMS provider rejected the sign-in code');
  throw sendFailed();
}

const consoleProvider: SmsProvider = {
  id: 'console',
  mode: 'dev',
  async send(to, code) {
    logger.warn({ to: maskPhone(to) }, `DEV MODE — sign-in code ${code} (no SMS was sent)`);
  },
};

const twilioProvider: SmsProvider = {
  id: 'twilio',
  mode: 'sms',
  async send(to, code) {
    const sid = env.TWILIO_ACCOUNT_SID as string;
    const body = new URLSearchParams({ To: to, Body: messageFor(code) });
    if (env.TWILIO_MESSAGING_SERVICE_SID) body.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
    else body.set('From', env.TWILIO_FROM as string);
    await post('twilio', `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  },
};

/** Hands the message to a gateway you run (or any SMS service with an HTTP API, behind a small adapter). */
const webhookProvider: SmsProvider = {
  id: 'webhook',
  mode: 'sms',
  async send(to, code) {
    await post('webhook', env.SMS_WEBHOOK_URL as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.SMS_WEBHOOK_SECRET ? { Authorization: `Bearer ${env.SMS_WEBHOOK_SECRET}` } : {}),
      },
      body: JSON.stringify({ to, code, text: messageFor(code) }),
    });
  },
};

/** Requests from this machine (a developer, or the Vite dev proxy). */
export const isLoopback = (ip: string | undefined): boolean => ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';

/**
 * The provider for a request. The development provider shows codes on screen, so it only serves
 * requests from this machine: a server accidentally left in development mode on the internet cannot
 * hand sign-in codes to strangers.
 */
export function getSmsProvider(viaLoopback = false): SmsProvider | null {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return viaLoopback ? consoleProvider : null;
    case 'twilio':
      return twilioProvider;
    case 'webhook':
      return webhookProvider;
    default:
      return null;
  }
}

/** What the sign-in screen should tell people about how their code will arrive. */
export const smsDelivery = (viaLoopback: boolean): 'sms' | 'dev' | 'unavailable' => {
  const provider = getSmsProvider(viaLoopback);
  return provider ? (provider.mode === 'dev' ? 'dev' : 'sms') : 'unavailable';
};

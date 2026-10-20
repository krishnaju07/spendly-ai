import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Load `.env` from the working directory or the repository root (never overriding real env vars). */
function loadDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(here, '../../../.env'), // bundled: apps/api/dist
    path.resolve(here, '../../../../.env'), // source: apps/api/src/config
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
  }
  return null;
}
loadDotEnv();

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/spendly'),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  COOKIE_SECURE: bool(false).optional(),
  TRUST_PROXY: z.string().default('0'),
  FORCE_HTTPS: bool(false),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),
  WEB_DIST: z.string().optional(),
  WORKER_ENABLED: bool(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEMO_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai']).default('none'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  // thinking tokens share this budget on current Claude models, so keep it roomy even for short answers
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(16000).default(4000),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  // sign-in codes: people sign in with a code texted to their mobile number
  SMS_PROVIDER: z.enum(['none', 'console', 'twilio', 'webhook']).optional(),
  SMS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
  OTP_RESEND_SECONDS: z.coerce.number().int().min(10).max(600).default(30),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_MAX_SENDS_PER_HOUR: z.coerce.number().int().min(1).max(30).default(5),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  SMS_WEBHOOK_URL: z.string().optional(),
  SMS_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${lines}`);
}
const raw = parsed.data;
const isProd = raw.NODE_ENV === 'production';

if (isProd && (!raw.SESSION_SECRET || raw.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production.');
}
if (raw.AI_PROVIDER !== 'none' && !raw.AI_API_KEY) {
  throw new Error(`AI_PROVIDER=${raw.AI_PROVIDER} requires AI_API_KEY (set AI_PROVIDER=none to disable AI).`);
}

// `console` prints codes to the log and shows them on the sign-in screen, so it is the development default
// and is refused in production, where an unset provider means "code sign-in is not available".
const smsProvider = raw.SMS_PROVIDER ?? (isProd ? 'none' : 'console');
if (smsProvider === 'console' && isProd) {
  throw new Error('SMS_PROVIDER=console is for development only (it shows sign-in codes on screen). Use twilio or webhook in production.');
}
if (smsProvider === 'twilio' && !(raw.TWILIO_ACCOUNT_SID && raw.TWILIO_AUTH_TOKEN && (raw.TWILIO_FROM || raw.TWILIO_MESSAGING_SERVICE_SID))) {
  throw new Error('SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID).');
}
if (smsProvider === 'webhook') {
  if (!raw.SMS_WEBHOOK_URL) throw new Error('SMS_PROVIDER=webhook requires SMS_WEBHOOK_URL.');
  if (isProd && !raw.SMS_WEBHOOK_URL.startsWith('https://')) throw new Error('SMS_WEBHOOK_URL must use https:// in production.');
}

/** The source tree (apps/api/src/config) and the bundle (apps/api/dist) sit at different depths, so look in each place. */
function findWebDist(): string {
  const candidates = [
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../../../web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find((c) => existsSync(path.join(c, 'index.html'))) ?? candidates[0]!;
}

export const env = {
  ...raw,
  SMS_PROVIDER: smsProvider,
  isProd,
  isTest: raw.NODE_ENV === 'test',
  // a fixed dev secret keeps dev sessions valid across restarts; production refuses to start without a real one
  SESSION_SECRET: raw.SESSION_SECRET ?? 'dev-only-insecure-session-secret-change-me-0123456789',
  COOKIE_SECURE: raw.COOKIE_SECURE ?? isProd,
  corsOrigins: (raw.CORS_ORIGINS ?? raw.APP_ORIGIN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  uploadDir: path.resolve(process.cwd(), raw.UPLOAD_DIR),
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  webDist: raw.WEB_DIST ? path.resolve(raw.WEB_DIST) : findWebDist(),
  demoTtlMs: raw.DEMO_TTL_HOURS * 3_600_000,
};

export type Env = typeof env;

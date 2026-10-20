import { pino } from 'pino';
import { SENSITIVE_KEYS } from '@spendly/shared';
import { env } from '../config/env';

const paths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];

/** Structured JSON logs with credentials, cookies and tokens redacted at every depth. */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths, censor: '[redacted]' },
  base: { service: 'spendly-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } } }),
});

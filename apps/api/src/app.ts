import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { csrfProtection, loadSession } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rate-limit';
import { v1 } from './routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => (req as express.Request).url === '/api/v1/health' },
      // log the route, never the query string: it can carry search terms and amounts
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }), res: (res) => ({ statusCode: res.statusCode }) },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  if (env.FORCE_HTTPS) {
    app.use((req, res, next) => (req.secure ? next() : res.redirect(308, `https://${req.get('host')}${req.originalUrl}`)));
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  // same-origin deployments need no CORS; it is only enabled when origins are configured explicitly
  if (process.env.CORS_ORIGINS) {
    app.use(
      '/api',
      cors({
        origin: env.corsOrigins,
        credentials: true,
        allowedHeaders: ['content-type', 'x-csrf-token', 'x-spendly-client', 'x-request-id'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        maxAge: 600,
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', apiLimiter, loadSession, csrfProtection, v1);
  app.use('/api', notFoundHandler);

  // the built web app (PWA), when present, is served from the same origin
  const dist = env.webDist;
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, file) => {
          const name = path.basename(file);
          if (name === 'sw.js' || name === 'index.html' || name === 'manifest.webmanifest' || name.startsWith('workbox-')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

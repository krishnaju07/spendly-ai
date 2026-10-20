import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError, z } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.requestId } });
};

interface Normalized {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function normalize(err: unknown): Normalized | null {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message, details: err.details };
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid input', details: z.flattenError(err) };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: Object.values(err.errors)[0]?.message ?? 'Invalid data' };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` };
  }
  const e = err as { code?: unknown; type?: string; status?: number; name?: string };
  if (e && typeof e === 'object') {
    if (e.code === 11000) return { status: 409, code: 'DUPLICATE', message: 'That record already exists' };
    if (e.code === 'LIMIT_FILE_SIZE') return { status: 413, code: 'FILE_TOO_LARGE', message: 'That file is larger than the upload limit' };
    if (e.name === 'MulterError') return { status: 400, code: 'UPLOAD_ERROR', message: 'The upload could not be read' };
    if (e.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    if (e.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  return null;
}

/** Single place errors become responses: consistent shape, request id, and no internals leaked. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = normalize(err);
  if (known) {
    if (known.status >= 500) logger.error({ err, requestId: req.requestId }, 'request failed');
    res.status(known.status).json({
      error: { code: known.code, message: known.message, details: known.details, requestId: req.requestId },
    });
    return;
  }
  logger.error({ err, requestId: req.requestId, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId: req.requestId },
  });
};

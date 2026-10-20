import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { AppError } from '../lib/errors';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates and coerces request input with Zod; parsed values land on req.valid. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    req.valid = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(part === 'body' ? (req.body ?? {}) : req[part]);
      if (!result.success) {
        const flat = z.flattenError(result.error);
        const first = result.error.issues[0];
        const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
        return next(
          new AppError(400, 'VALIDATION_ERROR', `${where}${first?.message ?? 'Invalid input'}`, {
            part,
            fieldErrors: flat.fieldErrors,
            formErrors: flat.formErrors,
            issues: result.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
      }
      req.valid[part] = result.data;
    }
    next();
  };

import type { Request } from 'express';
import type { Types } from 'mongoose';
import { unauthorized } from '../lib/errors';
import type { UserDoc, UserPreferenceDoc } from '../models/account';

export interface AuthContext {
  userId: Types.ObjectId;
  user: UserDoc;
  prefs: UserPreferenceDoc;
  sessionId: Types.ObjectId;
  sessionTokenHash: string;
  tz: string;
  weekStartsOn: 1 | 7;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      /** Output of the validate() middleware. req.query is read-only in Express 5, so results live here. */
      // already parsed and checked by validate(); each route narrows it to its own schema type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valid: { body?: any; query?: any; params?: any };
    }
  }
}

/** The authenticated context for this request; throws 401 if the route forgot requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Errors that are safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have access to this', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown, code = 'CONFLICT') =>
  new AppError(409, code, message, details);
export const unprocessable = (message: string, details?: unknown, code = 'UNPROCESSABLE') =>
  new AppError(422, code, message, details);
export const tooMany = (message = 'Too many requests. Please slow down.') =>
  new AppError(429, 'RATE_LIMITED', message);
export const unavailable = (message: string, code = 'UNAVAILABLE') => new AppError(503, code, message);

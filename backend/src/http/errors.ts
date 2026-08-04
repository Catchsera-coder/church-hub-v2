import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** A typed, intentional HTTP error. Anything else becomes a 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (msg = 'Not found') => new AppError(404, msg, 'not_found');
export const forbidden = (msg = 'Forbidden') => new AppError(403, msg, 'forbidden');
export const unauthorized = (msg = 'Unauthorized') => new AppError(401, msg, 'unauthorized');
export const badRequest = (msg = 'Bad request', details?: unknown) => new AppError(400, msg, 'bad_request', details);
export const conflict = (msg = 'Conflict') => new AppError(409, msg, 'conflict');

// Consistent error shape for the SPA: { error: { code, message, details? } }.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ error: { code: 'validation', message: 'Validation failed', details: err.flatten() } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // eslint-disable-next-line no-console
  console.error('unhandled error', err);
  return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong' } });
}

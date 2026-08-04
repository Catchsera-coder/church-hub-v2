import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessClaims } from '../auth/tokens.js';
import { unauthorized, forbidden } from '../http/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

const SUPER_ADMIN = 'Super Admin';

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    req.auth = verifyAccessToken(header.slice(7));
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}

/** Require one of the given permissions. Super Admin passes everything (v1 parity). */
export const requirePermission =
  (...perms: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const a = req.auth;
    if (!a) return next(unauthorized());
    if (a.roles.includes(SUPER_ADMIN)) return next();
    if (perms.some((p) => a.perms.includes(p))) return next();
    return next(forbidden());
  };

export const requireRole =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const a = req.auth;
    if (!a) return next(unauthorized());
    if (a.roles.includes(SUPER_ADMIN) || roles.some((r) => a.roles.includes(r))) return next();
    return next(forbidden());
  };

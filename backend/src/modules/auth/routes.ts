import { Router } from 'express';
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, refreshTokens } from '../../db/schema.js';
import { verifyPassword } from '../../auth/password.js';
import { signAccessToken, newRefreshToken, hashRefreshToken } from '../../auth/tokens.js';
import { loadRolesAndPerms } from './service.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { badRequest, unauthorized } from '../../http/errors.js';
import { config } from '../../config.js';

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Parse a TTL like "30d" / "12h" / "15m" into milliseconds (refresh only).
function ttlMs(ttl: string): number {
  const m = /^(\d+)([dhm])$/.exec(ttl.trim());
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  return n * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
}

async function issueSession(user: { id: number; email: string }) {
  const { roles, perms } = await loadRolesAndPerms(user.id);
  const accessToken = signAccessToken({ sub: user.id, email: user.email, roles, perms });
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + ttlMs(config.REFRESH_TOKEN_TTL));
  await db.insert(refreshTokens).values({ userId: user.id, tokenHash: hash, expiresAt });
  return { accessToken, refreshToken: token, roles, perms };
}

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, password))) {
      throw unauthorized('Invalid credentials');
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const session = await issueSession(user);
    res.json({
      ...session,
      user: { id: user.id, name: user.name, email: user.email, locale: user.locale },
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = z.object({ refreshToken: z.string().min(1) }).parse(req.body).refreshToken;
    const hash = hashRefreshToken(token);
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .limit(1);
    if (!row) throw unauthorized('Invalid refresh token');

    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) throw unauthorized();

    // Rotate: revoke the used token, issue a fresh pair.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const session = await issueSession(user);
    res.json(session);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (parsed.refreshToken) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, hashRefreshToken(parsed.refreshToken)));
    }
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const id = req.auth!.sub;
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw badRequest('User not found');
    res.json({
      user: { id: user.id, name: user.name, email: user.email, locale: user.locale },
      roles: req.auth!.roles,
      perms: req.auth!.perms,
    });
  }),
);

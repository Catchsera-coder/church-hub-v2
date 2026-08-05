import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, refreshTokens, passwordResetTokens } from '../../db/schema.js';
import { verifyPassword, hashPassword } from '../../auth/password.js';
import { signAccessToken, newRefreshToken, hashRefreshToken } from '../../auth/tokens.js';
import { loadRolesAndPerms } from './service.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { badRequest, unauthorized } from '../../http/errors.js';
import { config } from '../../config.js';
import { resolveMessaging, sendMessage } from '../messages/delivery.js';
import { currentOrg } from '../settings/routes.js';

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

// --- Password reset ---------------------------------------------------------
// Request a reset link. Always responds 200 (never reveals whether the email
// exists). If it matches an active user, a single-use token (1h) is emailed.
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });

      const base = config.PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
      const link = `${base}/reset-password?token=${token}`;
      const org = await currentOrg();
      const messaging = resolveMessaging(org.messaging);
      const subject = 'Reset your password';
      const body =
        `We received a request to reset your password.\n\n` +
        `Open this link to choose a new password (valid for 1 hour):\n${link}\n\n` +
        `If you didn't request this, you can ignore this email.`;
      await sendMessage(messaging, 'email', user.email, subject, body);
    }

    res.json({ ok: true });
  }),
);

// Complete the reset with a valid token.
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(1), password: z.string().min(8) }).parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .limit(1);
    if (!row) throw badRequest('This reset link is invalid or has expired.');

    await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, row.userId));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    // Invalidate existing sessions so a leaked token can't keep a session alive.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));

    res.json({ ok: true });
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

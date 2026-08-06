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

// --- Password reset (email code) --------------------------------------------
// Step 1: request a 6-digit code by email. Always responds 200 (never reveals
// whether the email exists). Code is single-use, expires in 15 minutes; any
// previous codes for the user are invalidated first.
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

    if (user && user.isActive) {
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const tokenHash = crypto.createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });

      const messaging = resolveMessaging((await currentOrg()).messaging);
      const subject = 'Your password reset code';
      const body =
        `Your password reset code is: ${code}\n\n` +
        `Enter it on the sign-in screen to choose a new password. It expires in 15 minutes.\n\n` +
        `If you didn't request this, you can ignore this email.`;
      await sendMessage(messaging, 'email', user.email, subject, body);
    }

    res.json({ ok: true });
  }),
);

// Step 2: complete the reset with email + code + new password.
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const { email, code, password } = z
      .object({ email: z.string().email(), code: z.string().trim().min(4), password: z.string().min(8) })
      .parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    const tokenHash = crypto.createHash('sha256').update(code).digest('hex');
    const [row] = user
      ? await db
          .select()
          .from(passwordResetTokens)
          .where(and(
            eq(passwordResetTokens.userId, user.id),
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ))
          .limit(1)
      : [];
    if (!user || !row) throw badRequest('That code is invalid or has expired.');
    // A user deactivated after requesting a code must not be able to complete a
    // reset — same generic message so it doesn't reveal account state.
    if (!user.isActive) throw badRequest('That code is invalid or has expired.');

    await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, user.id));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));

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

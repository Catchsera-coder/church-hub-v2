import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { badRequest, unauthorized, notFound } from '../../http/errors.js';
import { verifyMfaChallenge } from '../../auth/tokens.js';
import { issueSession } from './routes.js';
import {
  generateTotpSecret, verifyTotp, otpauthUri,
  generateRecoveryCodes, hashRecoveryCode,
  encryptSecret, decryptSecret,
} from '../../auth/mfa.js';
import { resolveMessaging, sendMessage } from '../messages/delivery.js';
import { brandedEmailHtml, localeName } from '../messages/render.js';
import { currentOrg } from '../settings/routes.js';

export const mfaRouter = Router();

const sessionResponse = async (user: any) => {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const session = await issueSession(user);
  return { ...session, user: { id: user.id, name: user.name, email: user.email, locale: user.locale, mustChangePassword: user.mustChangePassword } };
};

// ---- Management (authenticated) -------------------------------------------
mfaRouter.get('/status', authenticate, asyncHandler(async (req, res) => {
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!u) throw notFound();
  res.json({ data: { enabled: u.mfaEnabled, recoveryRemaining: (u.mfaRecoveryCodes ?? []).length, emailFallback: u.mfaEmailFallback } });
}));

// Begin enrollment: create a pending secret + return the otpauth URI for the QR.
mfaRouter.post('/setup', authenticate, asyncHandler(async (req, res) => {
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!u) throw notFound();
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaPendingSecret: encryptSecret(secret), updatedAt: new Date() }).where(eq(users.id, u.id));
  const org = await currentOrg();
  const issuer = localeName(org.name, org.locale || 'en') || 'Church Hub';
  res.json({ data: { secret, otpauthUri: otpauthUri(secret, u.email, issuer) } });
}));

// Confirm the first code → turn MFA on and issue one-time recovery codes.
mfaRouter.post('/enable', authenticate, asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(6) }).parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!u || !u.mfaPendingSecret) throw badRequest('Start setup first.');
  if (!verifyTotp(decryptSecret(u.mfaPendingSecret), code)) throw badRequest('That code is incorrect. Check your authenticator app and try again.');
  const recovery = generateRecoveryCodes();
  await db.update(users).set({
    mfaEnabled: true, mfaSecret: u.mfaPendingSecret, mfaPendingSecret: null,
    mfaRecoveryCodes: recovery.map(hashRecoveryCode), updatedAt: new Date(),
  }).where(eq(users.id, u.id));
  res.json({ data: { enabled: true, recoveryCodes: recovery } });
}));

// Turn MFA off — requires a valid current factor (TOTP or a recovery code).
mfaRouter.post('/disable', authenticate, asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(6) }).parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!u || !u.mfaEnabled || !u.mfaSecret) throw badRequest('MFA is not enabled.');
  const okTotp = verifyTotp(decryptSecret(u.mfaSecret), code);
  const okRecovery = (u.mfaRecoveryCodes ?? []).includes(hashRecoveryCode(code));
  if (!okTotp && !okRecovery) throw badRequest('That code is incorrect.');
  await db.update(users).set({
    mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaRecoveryCodes: [],
    mfaEmailCodeHash: null, mfaEmailCodeExpiresAt: null, updatedAt: new Date(),
  }).where(eq(users.id, u.id));
  res.json({ data: { enabled: false } });
}));

// Regenerate recovery codes (invalidates the old set).
mfaRouter.post('/recovery', authenticate, asyncHandler(async (req, res) => {
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!u || !u.mfaEnabled) throw badRequest('MFA is not enabled.');
  const recovery = generateRecoveryCodes();
  await db.update(users).set({ mfaRecoveryCodes: recovery.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(users.id, u.id));
  res.json({ data: { recoveryCodes: recovery } });
}));

// ---- Login challenge (unauthenticated; gated by the challenge token) -------
async function challengedUser(token: string) {
  const id = verifyMfaChallenge(token);
  if (!id) return null;
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u && u.isActive && u.mfaEnabled ? u : null;
}

// Send a one-time code to the user's email as an MFA fallback.
mfaRouter.post('/email-code', asyncHandler(async (req, res) => {
  const { challengeToken } = z.object({ challengeToken: z.string().min(10) }).parse(req.body);
  const u = await challengedUser(challengeToken);
  if (u && u.mfaEmailFallback && u.email) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.update(users).set({
      mfaEmailCodeHash: crypto.createHash('sha256').update(code).digest('hex'),
      mfaEmailCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000), updatedAt: new Date(),
    }).where(eq(users.id, u.id));
    const org = await currentOrg();
    const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
    if (messaging.emailProvider) {
      const churchName = localeName(org.name, 'en') || localeName(org.name, org.locale || 'en') || 'your church';
      const body = `Your ${churchName} sign-in code is:\n\n${code}\n\nEnter it to finish signing in. It expires in 10 minutes.\n\nIf you didn't try to sign in, you can ignore this email and your account stays secure.`;
      const html = brandedEmailHtml(body, org, { heading: 'Your sign-in code', preheader: `Your ${churchName} verification code`, highlight: { label: 'Verification code', lines: [code] } });
      try { await sendMessage(messaging, 'email', u.email, `Your ${churchName} sign-in code`, body, html); } catch { /* best-effort */ }
    }
  }
  res.json({ data: { sent: true } }); // never reveal whether the account/email exists
}));

// Complete sign-in with a TOTP code, an email code, or a recovery code.
mfaRouter.post('/verify', asyncHandler(async (req, res) => {
  const { challengeToken, code } = z.object({ challengeToken: z.string().min(10), code: z.string().min(6).max(20) }).parse(req.body);
  const u = await challengedUser(challengeToken);
  if (!u) throw unauthorized('Your sign-in session expired. Please sign in again.');
  const clean = code.trim();

  // 1) TOTP
  if (u.mfaSecret && verifyTotp(decryptSecret(u.mfaSecret), clean)) return res.json(await sessionResponse(u));

  // 2) Email OTP (single-use, time-limited)
  if (u.mfaEmailCodeHash && u.mfaEmailCodeExpiresAt && u.mfaEmailCodeExpiresAt > new Date()) {
    const match = crypto.timingSafeEqual(
      Buffer.from(crypto.createHash('sha256').update(clean).digest('hex')),
      Buffer.from(u.mfaEmailCodeHash),
    );
    if (match) {
      await db.update(users).set({ mfaEmailCodeHash: null, mfaEmailCodeExpiresAt: null }).where(eq(users.id, u.id));
      return res.json(await sessionResponse(u));
    }
  }

  // 3) Recovery code (consumed on use)
  const h = hashRecoveryCode(clean);
  const codes = u.mfaRecoveryCodes ?? [];
  if (codes.includes(h)) {
    await db.update(users).set({ mfaRecoveryCodes: codes.filter((c) => c !== h), updatedAt: new Date() }).where(eq(users.id, u.id));
    return res.json(await sessionResponse(u));
  }

  throw unauthorized('That code is incorrect or has expired.');
}));

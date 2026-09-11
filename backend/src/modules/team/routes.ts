import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, roles, userRoles, refreshTokens } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { hashPassword, passwordIssue } from '../../auth/password.js';
import { logActivity } from '../activity/service.js';
import { config } from '../../config.js';
import { resolveMessaging, sendMessage } from '../messages/delivery.js';
import { brandedEmailHtml, renderText, localeName } from '../messages/render.js';
import { currentOrg } from '../settings/routes.js';

// --- Team-member invitation email ------------------------------------------
// A new team member gets a branded "join the hub" email with a link to set their
// own password (opaque token, hashed at rest, 14-day TTL) — no password is ever
// emailed. Rendering is shared by send + preview so the two always match.
const INVITE_TTL_DAYS = 14;
function newInviteToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}
function inviteLink(token: string): string | null {
  const base = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  return base ? `${base}/accept-invite?token=${token}` : null;
}
type InviteMode = 'invite' | 'reset';
function renderInvite(org: any, user: { name: string; email: string }, link: string | null, mode: InviteMode = 'invite'): { subject: string; body: string; html: string } {
  const lang = org.locale || 'en';
  // The hub is staff-facing and English — always use the church's English name here
  // (fall back to the local name only if no English name is set).
  const churchName = localeName(org.name, 'en') || localeName(org.name, lang) || 'your church';
  const first = (user.name || '').split(/\s+/)[0] || user.name || 'there';
  const reset = mode === 'reset';
  const subject = reset ? `Reset your ${churchName} password` : `You're invited to join ${churchName}`;
  const heading = reset ? 'Reset your password' : (link ? 'Welcome to the team' : `You're invited to ${churchName}`);
  const intro = reset
    ? `We received a request to reset the password for your ${churchName} hub account.`
    : `You've been given access to ${churchName}'s management hub — the tools the team uses to care for the church family.`;
  const action = link
    ? (reset
        ? `Click the button below to choose a new password. Please pick a strong one you don't use anywhere else.`
        : `Set your password with the button below to activate your account and sign in. Please choose a strong password you don't use anywhere else.`)
    : `Ask your administrator for your sign-in link to set your password.`;
  const body = `Hi ${first},\n\n${intro}\n\n${action}`;
  const bodyFooterNote = reset
    ? `This secure link is just for you and expires in 14 days. If you didn't request this, you can safely ignore this email — your password stays the same.`
    : (link
        ? `This secure link is just for you and expires in 14 days. If you weren't expecting this invitation, you can safely ignore this email.`
        : `If you weren't expecting this invitation, you can safely ignore this email.`);
  const signature = renderText(localeName(org.emailSettings?.signature, lang), { churchName }) || undefined;
  const html = brandedEmailHtml(body, org, {
    lang,
    heading,
    signature,
    highlight: { label: reset ? 'Account' : 'Your sign-in', lines: [user.name, user.email] },
    cta: link ? { label: reset ? 'Set a new password' : 'Set your password & sign in', url: link } : null,
    preheader: reset ? `Reset your ${churchName} password` : `Your invitation to ${churchName}`,
    bodyFooterNote,
  });
  return { subject, body, html };
}
async function sendInviteEmail(user: { id: number; name: string; email: string }, mode: InviteMode = 'invite'): Promise<boolean> {
  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
  if (!messaging.emailProvider) return false; // email not configured — creation still succeeds
  const { token, hash } = newInviteToken();
  await db.update(users)
    .set({ inviteTokenHash: hash, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  const { subject, body, html } = renderInvite(org, user, inviteLink(token), mode);
  return await sendMessage(messaging, 'email', user.email, subject, body, html);
}

export const teamRouter = Router();
teamRouter.use(authenticate);

// --- Super Admin safeguards -------------------------------------------------
// Prevent privilege escalation: only a Super Admin may grant/manage the
// Super Admin role or a Super Admin account, and the last Super Admin can't be
// removed/deactivated (which would lock everyone out of admin).
const isSuper = (req: { auth?: { roles?: string[] } }) => !!req.auth?.roles?.includes('Super Admin');

async function superAdminRoleId(): Promise<number | null> {
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Super Admin')).limit(1);
  return r?.id ?? null;
}
async function userHasRole(userId: number, roleId: number): Promise<boolean> {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  return (r?.c ?? 0) > 0;
}
async function activeSuperAdminCount(saId: number): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(distinct ${users.id})::int` }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleId, saId), eq(users.isActive, true)));
  return r?.c ?? 0;
}

teamRouter.get('/', requirePermission('view user'), asyncHandler(async (_req, res) => {
  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email, isActive: users.isActive,
      invitedAt: users.invitedAt, lastLoginAt: users.lastLoginAt, mfaEnabled: users.mfaEnabled,
      roles: sql<string[]>`coalesce(array_agg(${roles.name}) filter (where ${roles.name} is not null), '{}')`,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .groupBy(users.id)
    .orderBy(users.name);
  res.json({ data: rows });
}));

teamRouter.get('/roles', requirePermission('view user'), asyncHandler(async (_req, res) => {
  res.json({ data: await db.select().from(roles).orderBy(roles.id) });
}));

const createSchema = z.object({
  name: z.string().min(1).max(190),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  roleIds: z.array(z.number().int().positive()).default([]),
  // Send the branded invite email now (default: yes when no password is set).
  sendInvite: z.boolean().optional(),
});

async function setRoles(userId: number, roleIds: number[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  for (const roleId of roleIds) await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
}

teamRouter.post('/', requirePermission('create user'), asyncHandler(async (req, res) => {
  const b = createSchema.parse(req.body);
  const saId = await superAdminRoleId();
  if (saId && b.roleIds.includes(saId) && !isSuper(req)) throw badRequest('Only a Super Admin can grant the Super Admin role.');
  const email = b.email.toLowerCase();
  if (b.password) { const w = passwordIssue(b.password, { email, name: b.name }); if (w) throw badRequest(w); }
  const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (dup) throw conflict('A user with this email already exists');
  const [row] = await db.insert(users).values({
    name: b.name,
    email,
    passwordHash: b.password ? await hashPassword(b.password) : null,
    invitedAt: b.password ? null : new Date(), // no password => invited (set via invite link)
    // If an admin sets an initial password, force a change at first login.
    mustChangePassword: !!b.password,
  }).returning();
  await setRoles(row!.id, b.roleIds);
  await logActivity(req, 'created', 'user', row!.id);
  // Send the invite email now unless the caller opted out (default: send when no
  // password was set). Never blocks creation if email isn't configured/fails.
  let inviteSent = false;
  const wantsInvite = b.sendInvite ?? !b.password;
  if (wantsInvite) { try { inviteSent = await sendInviteEmail({ id: row!.id, name: row!.name, email: row!.email }); } catch { inviteSent = false; } }
  res.status(201).json({ data: { ...row, passwordHash: undefined }, inviteSent });
}));

// (Re)send the invite email — used for "send now", "send later", or "resend".
teamRouter.post('/:id/invite', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw notFound();
  const sent = await sendInviteEmail(u);
  await logActivity(req, 'updated', 'user', id, sent ? 'invite email sent' : 'invite email not sent (email not configured)');
  res.json({ data: { sent } });
}));

// Preview the invite email for a member (rendered, not sent) — shown on the team page.
teamRouter.get('/:id/invite-preview', requirePermission('view user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw notFound();
  const org = await currentOrg();
  const base = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  const link = base ? `${base}/accept-invite?token=EXAMPLE-TOKEN` : null; // placeholder; real token is embedded only when sent
  const { subject, html } = renderInvite(org, u, link);
  res.json({ data: { subject, html, to: u.email } });
}));

const updateSchema = z.object({
  name: z.string().min(1).max(190).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

teamRouter.put('/:id', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = updateSchema.parse(req.body);
  const saId = await superAdminRoleId();
  if (saId) {
    const targetIsSuper = await userHasRole(id, saId);
    const grantingSuper = b.roleIds?.includes(saId) ?? false;
    if ((grantingSuper || targetIsSuper) && !isSuper(req)) throw badRequest('Only a Super Admin can manage the Super Admin role.');
    // Removing SA (roleIds without it) or deactivating the last SA is blocked.
    const removingSuper = b.roleIds !== undefined && !grantingSuper;
    const deactivating = b.isActive === false;
    if (targetIsSuper && (removingSuper || deactivating) && (await activeSuperAdminCount(saId)) <= 1) {
      throw badRequest('Cannot remove or deactivate the last Super Admin.');
    }
  }
  const [row] = await db.update(users).set({
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();
  if (!row) throw notFound();
  if (b.roleIds) await setRoles(id, b.roleIds);
  await logActivity(req, 'updated', 'user', id);
  res.json({ data: { ...row, passwordHash: undefined } });
}));

teamRouter.post('/:id/deactivate', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const saId = await superAdminRoleId();
  if (saId && await userHasRole(id, saId)) {
    if (!isSuper(req)) throw badRequest('Only a Super Admin can deactivate a Super Admin.');
    if ((await activeSuperAdminCount(saId)) <= 1) throw badRequest('Cannot deactivate the last Super Admin.');
  }
  const [row] = await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'user', id, 'deactivated');
  res.json({ data: { ...row, passwordHash: undefined } });
}));

// Admin-set a user's password (recovery without email). No account lockout.
teamRouter.post('/:id/set-password', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
  const weakSet = passwordIssue(password);
  if (weakSet) throw badRequest(weakSet);
  const saId = await superAdminRoleId();
  if (saId && await userHasRole(id, saId) && !isSuper(req)) throw badRequest("Only a Super Admin can set a Super Admin's password.");
  const [row] = await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'user', id, 'password set by admin');
  res.json({ data: { ok: true } });
}));

// Force-reset a user's two-factor auth (lockout recovery — lost device + recovery
// codes). Wipes all MFA state so they can sign in with their password and
// re-enrol. A Super Admin's 2FA can only be reset by another Super Admin.
// Revokes the target's active sessions and is audit-logged.
teamRouter.post('/:id/mfa-reset', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const saId = await superAdminRoleId();
  if (saId && (await userHasRole(id, saId)) && !isSuper(req)) {
    throw badRequest("Only a Super Admin can reset a Super Admin's two-factor authentication.");
  }
  const [row] = await db.update(users).set({
    mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaRecoveryCodes: [],
    mfaEmailCodeHash: null, mfaEmailCodeExpiresAt: null, updatedAt: new Date(),
  }).where(eq(users.id, id)).returning();
  if (!row) throw notFound();
  // Force the affected user to re-authenticate.
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
  await logActivity(req, 'updated', 'user', id, 'two-factor authentication reset by admin');
  res.json({ data: { ok: true } });
}));

// Email the user a secure password-reset link (admin-initiated) — the admin never
// sees or sets the password; the user chooses their own via the link.
teamRouter.post('/:id/send-reset', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw notFound();
  const sent = await sendInviteEmail(u, 'reset');
  await logActivity(req, 'updated', 'user', id, sent ? 'password-reset link sent by admin' : 'password-reset link not sent (email not configured)');
  res.json({ data: { sent } });
}));

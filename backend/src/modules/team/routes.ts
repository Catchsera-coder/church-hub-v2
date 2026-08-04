import { Router } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, roles, userRoles } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { conflict, notFound } from '../../http/errors.js';
import { hashPassword } from '../../auth/password.js';
import { logActivity } from '../activity/service.js';

export const teamRouter = Router();
teamRouter.use(authenticate);

teamRouter.get('/', requirePermission('view user'), asyncHandler(async (_req, res) => {
  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email, isActive: users.isActive,
      invitedAt: users.invitedAt, lastLoginAt: users.lastLoginAt,
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
});

async function setRoles(userId: number, roleIds: number[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  for (const roleId of roleIds) await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
}

teamRouter.post('/', requirePermission('create user'), asyncHandler(async (req, res) => {
  const b = createSchema.parse(req.body);
  const email = b.email.toLowerCase();
  const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (dup) throw conflict('A user with this email already exists');
  const [row] = await db.insert(users).values({
    name: b.name,
    email,
    passwordHash: b.password ? await hashPassword(b.password) : null,
    invitedAt: b.password ? null : new Date(), // no password => invited (set via reset flow)
  }).returning();
  await setRoles(row!.id, b.roleIds);
  await logActivity(req, 'created', 'user', row!.id);
  res.status(201).json({ data: { ...row, passwordHash: undefined } });
}));

const updateSchema = z.object({
  name: z.string().min(1).max(190).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

teamRouter.put('/:id', requirePermission('update user'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = updateSchema.parse(req.body);
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
  const [row] = await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'user', id, 'deactivated');
  res.json({ data: { ...row, passwordHash: undefined } });
}));

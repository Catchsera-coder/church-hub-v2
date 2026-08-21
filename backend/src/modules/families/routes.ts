import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { households, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { familyListQuery, familyWhere, memberCountExpr, childCountExpr, familyPhoneExpr } from './filters.js';

export const familiesRouter = Router();
familiesRouter.use(authenticate);

const schema = z.object({
  name: z.record(z.string()).default({}),
  homePhone: z.string().max(40).nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});

familiesRouter.get('/', requirePermission('view household'), asyncHandler(async (req, res) => {
  const q = familyListQuery.parse(req.query);
  const { page, limit } = q;
  const memberCount = memberCountExpr;
  const childCount = childCountExpr;
  const where = familyWhere(q);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(households).where(where);
  const rows = await db
    .select({
      id: households.id, name: households.name,
      homePhone: familyPhoneExpr, // household phone, else a member's mobile
      city: households.city, region: households.region,
      memberCount, childCount,
      createdAt: households.createdAt, updatedAt: households.updatedAt,
    })
    .from(households)
    .where(where)
    .orderBy(desc(households.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  res.json({ data: rows, meta: { page, limit, total: count, pages: Math.ceil(count / limit) } });
}));

familiesRouter.get('/:id', requirePermission('view household'), asyncHandler(async (req, res) => {
  const [row] = await db.select().from(households).where(and(eq(households.id, Number(req.params.id)), isNull(households.deletedAt))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

// People in this family (for the in-page member manager). Returns enough to
// render rich member cards AND inline-edit them without leaving the family page.
familiesRouter.get('/:id/members', requirePermission('view household'), asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      id: people.id, givenName: people.givenName, middleName: people.middleName, familyName: people.familyName,
      membershipStatus: people.membershipStatus, email: people.email, mobile: people.mobile,
      householdRole: people.householdRole, dateOfBirth: people.dateOfBirth, joinedOn: people.joinedOn,
      preferredLanguage: people.preferredLanguage, isActive: people.isActive,
      emailOptOut: people.emailOptOut, smsOptOut: people.smsOptOut, whatsappOptOut: people.whatsappOptOut,
      selfRegistered: people.selfRegistered, reviewedAt: people.reviewedAt,
    })
    .from(people)
    .where(and(eq(people.householdId, Number(req.params.id)), isNull(people.deletedAt)))
    .orderBy(desc(people.createdAt));
  res.json({ data: rows });
}));

familiesRouter.post('/', requirePermission('create household'), asyncHandler(async (req, res) => {
  const [row] = await db.insert(households).values(schema.parse(req.body)).returning();
  await logActivity(req, 'created', 'household', row!.id);
  res.status(201).json({ data: row });
}));

familiesRouter.put('/:id', requirePermission('update household'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(households).set({ ...schema.partial().parse(req.body), updatedAt: new Date() }).where(and(eq(households.id, id), isNull(households.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'household', id);
  res.json({ data: row });
}));

familiesRouter.delete('/:id', requirePermission('delete household'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(households).set({ deletedAt: new Date() }).where(and(eq(households.id, id), isNull(households.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'household', id);
  res.status(204).end();
}));

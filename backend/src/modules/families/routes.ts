import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { households, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

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

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  city: z.string().trim().optional(),
  hasChildren: z.enum(['true']).optional(),
  missingContact: z.enum(['true']).optional(),
  minSize: z.coerce.number().int().min(1).optional(),
});

// Correlated counts so the list can show family size + how many children.
const memberCount = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.is_active = true)`;
const childCount = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.date_of_birth IS NOT NULL AND extract(year from age(p.date_of_birth)) < 13)`;

familiesRouter.get('/', requirePermission('view household'), asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, search } = q;
  const filters = [isNull(households.deletedAt)];
  if (search) {
    const like = `%${search}%`;
    filters.push(sql`(${households.name}->>'en' ILIKE ${like} OR ${households.name}->>'ar' ILIKE ${like} OR ${households.city} ILIKE ${like})`);
  }
  if (q.city) filters.push(sql`${households.city} ILIKE ${`%${q.city}%`}`);
  if (q.hasChildren === 'true') filters.push(sql`${childCount} > 0`);
  if (q.minSize) filters.push(sql`${memberCount} >= ${q.minSize}`);
  if (q.missingContact === 'true') {
    filters.push(sql`(${households.homePhone} IS NULL OR ${households.homePhone} = '')
      AND NOT EXISTS (SELECT 1 FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL
        AND ((p.email IS NOT NULL AND p.email <> '') OR (p.mobile IS NOT NULL AND p.mobile <> '')))`);
  }
  const where = and(...filters);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(households).where(where);
  const rows = await db
    .select({
      id: households.id, name: households.name, homePhone: households.homePhone,
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

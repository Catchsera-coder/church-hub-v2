import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { vendors } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

// Vendor directory. Admin-managed (like forms/automations) — no new RBAC resource.
export const vendorsRouter = Router();
vendorsRouter.use(authenticate);
vendorsRouter.use(requireRole('Admin'));

const schema = z.object({
  name: z.string().trim().min(1).max(190),
  title: z.string().max(120).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  email: z.union([z.string().email().max(190), z.literal('')]).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
  website: z.string().max(190).nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const listQuery = z.object({ search: z.string().trim().optional(), category: z.string().trim().optional() });

vendorsRouter.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const filters = [isNull(vendors.deletedAt)];
  if (q.search) {
    const like = `%${q.search}%`;
    filters.push(sql`(${vendors.name} ILIKE ${like} OR ${vendors.title} ILIKE ${like} OR ${vendors.category} ILIKE ${like} OR ${vendors.email} ILIKE ${like} OR ${vendors.phone} ILIKE ${like} OR ${vendors.mobile} ILIKE ${like})`);
  }
  if (q.category) filters.push(eq(vendors.category, q.category));
  const rows = await db.select().from(vendors).where(and(...filters)).orderBy(asc(vendors.name));
  res.json({ data: rows });
}));

vendorsRouter.get('/:id', asyncHandler(async (req, res) => {
  const [row] = await db.select().from(vendors).where(and(eq(vendors.id, Number(req.params.id)), isNull(vendors.deletedAt))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

vendorsRouter.post('/', asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(vendors).values({ ...b, email: b.email || null }).returning();
  await logActivity(req, 'created', 'vendor', row!.id);
  res.status(201).json({ data: row });
}));

vendorsRouter.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = schema.partial().parse(req.body);
  const patch: Record<string, unknown> = { ...b, updatedAt: new Date() };
  if (b.email !== undefined) patch.email = b.email || null;
  const [row] = await db.update(vendors).set(patch).where(and(eq(vendors.id, id), isNull(vendors.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'vendor', id);
  res.json({ data: row });
}));

vendorsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(vendors).set({ deletedAt: new Date() }).where(and(eq(vendors.id, id), isNull(vendors.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'vendor', id);
  res.status(204).end();
}));

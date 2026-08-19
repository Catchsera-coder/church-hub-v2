import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { serviceTypes } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const ministriesRouter = Router();
ministriesRouter.use(authenticate);

const schema = z.object({
  name: z.record(z.string()).default({}),
  description: z.record(z.string()).default({}),
  ageGroup: z.enum(['children', 'youth', 'adult']).nullable().optional(),
  defaultSchedule: z.string().max(120).nullable().optional(),
  // Live-stream link: a fixed URL, or a YouTube handle/channel for the /live permalink.
  streaming: z.object({
    mode: z.enum(['manual', 'youtube']),
    url: z.string().max(500).optional(),
    youtube: z.string().max(120).optional(),
  }).nullable().optional(),
  // Parent ministry (group). null/omitted = top-level.
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

ministriesRouter.get('/', requirePermission('view ministry'), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(serviceTypes).where(isNull(serviceTypes.deletedAt)).orderBy(asc(serviceTypes.sortOrder));
  res.json({ data: rows });
}));

ministriesRouter.post('/', requirePermission('create ministry'), asyncHandler(async (req, res) => {
  const [row] = await db.insert(serviceTypes).values(schema.parse(req.body)).returning();
  await logActivity(req, 'created', 'ministry', row!.id);
  res.status(201).json({ data: row });
}));

ministriesRouter.put('/:id', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = schema.partial().parse(req.body);
  if (body.parentId === id) throw badRequest('A ministry cannot be its own parent');
  const [row] = await db.update(serviceTypes).set({ ...body, updatedAt: new Date() }).where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'ministry', id);
  res.json({ data: row });
}));

ministriesRouter.delete('/:id', requirePermission('delete ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(serviceTypes).set({ deletedAt: new Date() }).where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'ministry', id);
  res.status(204).end();
}));

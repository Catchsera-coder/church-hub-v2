import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { sermons } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const sermonsRouter = Router();
sermonsRouter.use(authenticate);

const schema = z.object({
  title: z.record(z.string()).default({}),
  summary: z.record(z.string()).default({}),
  speaker: z.string().max(190).nullable().optional(),
  preachedOn: z.string(),
  scriptureReference: z.string().max(190).nullable().optional(),
  language: z.string().max(8).default('en'),
  audioPath: z.string().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  durationSeconds: z.number().int().nullable().optional(),
  isPublished: z.boolean().default(false),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
});

sermonsRouter.get('/', requirePermission('view sermon'), asyncHandler(async (req, res) => {
  const { page, limit, search } = listQuery.parse(req.query);
  const filters = [] as ReturnType<typeof sql>[];
  if (search) {
    const like = `%${search}%`;
    filters.push(sql`(${sermons.title}->>'en' ILIKE ${like} OR ${sermons.title}->>'ar' ILIKE ${like} OR ${sermons.speaker} ILIKE ${like})`);
  }
  const where = filters.length ? and(...filters) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(sermons).where(where);
  const rows = await db.select().from(sermons).where(where).orderBy(desc(sermons.preachedOn)).limit(limit).offset((page - 1) * limit);
  res.json({ data: rows, meta: { page, limit, total: count, pages: Math.ceil(count / limit) } });
}));

sermonsRouter.get('/:id', requirePermission('view sermon'), asyncHandler(async (req, res) => {
  const [row] = await db.select().from(sermons).where(eq(sermons.id, Number(req.params.id))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

sermonsRouter.post('/', requirePermission('create sermon'), asyncHandler(async (req, res) => {
  const [row] = await db.insert(sermons).values(schema.parse(req.body)).returning();
  await logActivity(req, 'created', 'sermon', row!.id);
  res.status(201).json({ data: row });
}));

sermonsRouter.put('/:id', requirePermission('update sermon'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(sermons).set({ ...schema.partial().parse(req.body), updatedAt: new Date() }).where(eq(sermons.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'sermon', id);
  res.json({ data: row });
}));

sermonsRouter.delete('/:id', requirePermission('delete sermon'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(sermons).where(eq(sermons.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'sermon', id);
  res.status(204).end();
}));

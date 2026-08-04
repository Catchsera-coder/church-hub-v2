import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const peopleRouter = Router();
peopleRouter.use(authenticate);

const i18n = z.record(z.string()).default({});
const upsertSchema = z.object({
  givenName: i18n,
  familyName: i18n,
  householdId: z.number().int().positive().nullable().optional(),
  membershipStatus: z.enum(['visitor', 'regular', 'member', 'inactive']).default('visitor'),
  email: z.string().email().nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
  preferredLanguage: z.string().max(8).default('en'),
  dateOfBirth: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  status: z.enum(['visitor', 'regular', 'member', 'inactive']).optional(),
});

// GET /api/people — paginated, searchable across both locales of the name.
peopleRouter.get(
  '/',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const { page, limit, search, status } = listQuery.parse(req.query);
    const filters = [isNull(people.deletedAt)];
    if (status) filters.push(eq(people.membershipStatus, status));
    if (search) {
      const like = `%${search}%`;
      filters.push(
        sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
          OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like}
          OR ${people.email} ILIKE ${like} OR ${people.mobile} ILIKE ${like})`,
      );
    }
    const where = and(...filters);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(people).where(where);
    const rows = await db
      .select()
      .from(people)
      .where(where)
      .orderBy(desc(people.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({ data: rows, meta: { page, limit, total: count, pages: Math.ceil(count / limit) } });
  }),
);

peopleRouter.get(
  '/:id',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db.select().from(people).where(and(eq(people.id, id), isNull(people.deletedAt))).limit(1);
    if (!row) throw notFound();
    res.json({ data: row });
  }),
);

peopleRouter.post(
  '/',
  requirePermission('create person'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body);
    const [row] = await db.insert(people).values(body).returning();
    await logActivity(req, 'created', 'person', row!.id);
    res.status(201).json({ data: row });
  }),
);

peopleRouter.put(
  '/:id',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = upsertSchema.partial().parse(req.body);
    const [row] = await db
      .update(people)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt)))
      .returning();
    if (!row) throw notFound();
    await logActivity(req, 'updated', 'person', id);
    res.json({ data: row });
  }),
);

// Soft delete — historical contributions must keep resolving a name.
peopleRouter.delete(
  '/:id',
  requirePermission('delete person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db
      .update(people)
      .set({ deletedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt)))
      .returning();
    if (!row) throw notFound();
    await logActivity(req, 'deleted', 'person', id);
    res.status(204).end();
  }),
);

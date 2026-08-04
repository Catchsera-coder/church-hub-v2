import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { activityLog, users } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

export const activityRouter = Router();
activityRouter.use(authenticate);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Read-only audit trail (written automatically by logActivity). Admins only.
activityRouter.get('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { page, limit } = listQuery.parse(req.query);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(activityLog);
  const rows = await db
    .select({
      id: activityLog.id, event: activityLog.event, subjectType: activityLog.subjectType,
      subjectId: activityLog.subjectId, description: activityLog.description, createdAt: activityLog.createdAt,
      causer: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.causerId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  res.json({ data: rows, meta: { page, limit, total: count, pages: Math.ceil(count / limit) } });
}));

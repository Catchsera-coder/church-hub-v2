import { Router } from 'express';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households, attendanceRecords, contributions } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// The base counts (members, households, attendance-this-month) are identical for
// every user and change slowly. Cache them briefly so a dashboard that several
// staff keep open doesn't hammer the DB with the same three COUNTs every load.
const BASE_TTL_MS = 60_000;
let baseCache: { at: number; data: { members: number; households: number; attendanceThisMonth: number } } | null = null;

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const startDate = monthStart.toISOString().slice(0, 10);
    const endDate = monthEnd.toISOString().slice(0, 10);

    let base = baseCache && Date.now() - baseCache.at < BASE_TTL_MS ? baseCache.data : null;
    if (!base) {
      const [members] = await db.select({ c: sql<number>`count(*)::int` }).from(people).where(and(eq(people.isActive, true), isNull(people.deletedAt)));
      const [fams] = await db.select({ c: sql<number>`count(*)::int` }).from(households).where(isNull(households.deletedAt));
      const [att] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(attendanceRecords)
        .where(and(gte(attendanceRecords.checkedInAt, monthStart), lte(attendanceRecords.checkedInAt, monthEnd)));
      base = {
        members: members?.c ?? 0,
        households: fams?.c ?? 0,
        attendanceThisMonth: att?.c ?? 0,
      };
      baseCache = { at: Date.now(), data: base };
    }

    const stats: Record<string, number> = { ...base };

    // Giving is sensitive: only for users who may view contributions.
    if (req.auth!.roles.includes('Super Admin') || req.auth!.perms.includes('view contribution')) {
      const [giving] = await db
        .select({ net: sql<number>`coalesce(sum(${contributions.amountCents}),0)::bigint` })
        .from(contributions)
        .where(and(gte(contributions.receivedOn, startDate), lte(contributions.receivedOn, endDate), isNull(contributions.deletedAt)));
      stats.givingThisMonthCents = Number(giving?.net ?? 0);
    }

    res.json({ data: stats });
  }),
);

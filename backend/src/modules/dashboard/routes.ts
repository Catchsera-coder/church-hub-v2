import { Router } from 'express';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households, attendanceRecords, attendanceEvents, serviceTypes, contributions } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// The non-financial stats are identical for every user and change slowly. Cache
// them briefly so a dashboard several staff keep open doesn't re-run every query.
const BASE_TTL_MS = 60_000;
type ServiceCount = { name: Record<string, string> | null; count: number };
type Base = {
  members: number; households: number; attendanceThisMonth: number;
  newMembersThisMonth: number; awaitingApproval: number; birthdaysThisMonth: number;
  upcomingGatherings: number; attendanceByService: ServiceCount[];
};
let baseCache: { at: number; data: Base } | null = null;

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const month = now.getMonth() + 1;
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
      const [newMembers] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(people)
        .where(and(isNull(people.deletedAt), gte(people.createdAt, monthStart), lte(people.createdAt, monthEnd)));
      const [pending] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(people)
        .where(and(isNull(people.deletedAt), eq(people.selfRegistered, true), isNull(people.reviewedAt)));
      const [bdays] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(people)
        .where(and(isNull(people.deletedAt), eq(people.isActive, true), sql`extract(month from ${people.dateOfBirth}) = ${month}`));
      const [upcoming] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(attendanceEvents)
        .where(gte(attendanceEvents.startsAt, now));
      // Attendance this month broken down by service/ministry (General = no service).
      const svc = await db
        .select({ name: serviceTypes.name, count: sql<number>`count(*)::int` })
        .from(attendanceRecords)
        .innerJoin(attendanceEvents, eq(attendanceEvents.id, attendanceRecords.attendanceEventId))
        .leftJoin(serviceTypes, eq(serviceTypes.id, attendanceEvents.serviceTypeId))
        .where(and(gte(attendanceRecords.checkedInAt, monthStart), lte(attendanceRecords.checkedInAt, monthEnd)))
        .groupBy(serviceTypes.id, serviceTypes.name)
        .orderBy(sql`count(*) desc`);
      base = {
        members: members?.c ?? 0,
        households: fams?.c ?? 0,
        attendanceThisMonth: att?.c ?? 0,
        newMembersThisMonth: newMembers?.c ?? 0,
        awaitingApproval: pending?.c ?? 0,
        birthdaysThisMonth: bdays?.c ?? 0,
        upcomingGatherings: upcoming?.c ?? 0,
        attendanceByService: svc.map((s) => ({ name: s.name ?? null, count: s.count })),
      };
      baseCache = { at: Date.now(), data: base };
    }

    const stats: Record<string, unknown> = { ...base };

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

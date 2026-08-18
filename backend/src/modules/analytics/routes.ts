import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';

// Church analytics: attendance trends, per-ministry attendance, membership growth,
// and (permission-gated) giving. Read-only aggregates.
export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

type LC = { label: string; count: number };

analyticsRouter.get('/overview', requirePermission('view person'), asyncHandler(async (req, res) => {
  const attendanceTrend = (await db.execute(sql`
    SELECT to_char(date_trunc('week', checked_in_at), 'Mon DD') AS label, count(*)::int AS count
    FROM attendance_records
    WHERE checked_in_at >= now() - interval '12 weeks'
    GROUP BY date_trunc('week', checked_in_at)
    ORDER BY date_trunc('week', checked_in_at)
  `)).rows.map((r) => ({ label: String(r.label), count: Number(r.count) })) as LC[];

  const attendanceByMinistry = (await db.execute(sql`
    SELECT coalesce(st.name->>'en', 'General') AS label, count(*)::int AS count
    FROM attendance_records ar
    JOIN attendance_events ae ON ae.id = ar.attendance_event_id
    LEFT JOIN service_types st ON st.id = ae.service_type_id
    WHERE ar.checked_in_at >= now() - interval '3 months'
    GROUP BY st.id, st.name
    ORDER BY count(*) DESC
    LIMIT 12
  `)).rows.map((r) => ({ label: String(r.label), count: Number(r.count) })) as LC[];

  const newMembersByMonth = (await db.execute(sql`
    SELECT to_char(date_trunc('month', created_at), 'Mon YY') AS label, count(*)::int AS count
    FROM people
    WHERE deleted_at IS NULL AND created_at >= now() - interval '6 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY date_trunc('month', created_at)
  `)).rows.map((r) => ({ label: String(r.label), count: Number(r.count) })) as LC[];

  const data: Record<string, unknown> = { attendanceTrend, attendanceByMinistry, newMembersByMonth };

  if (req.auth!.roles.includes('Super Admin') || req.auth!.perms.includes('view contribution')) {
    data.givingByMonth = (await db.execute(sql`
      SELECT to_char(date_trunc('month', received_on::timestamp), 'Mon YY') AS label, coalesce(sum(amount_cents), 0)::bigint AS cents
      FROM contributions
      WHERE deleted_at IS NULL AND received_on >= (now() - interval '6 months')::date
      GROUP BY date_trunc('month', received_on::timestamp)
      ORDER BY date_trunc('month', received_on::timestamp)
    `)).rows.map((r) => ({ label: String(r.label), cents: Number(r.cents) }));
  }

  res.json({ data });
}));

import { Router } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
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

// ---------------------------------------------------------------------------
// Attendance Insights — interactive, filterable analysis with actionable lists.
// ---------------------------------------------------------------------------
const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceTypeId: z.coerce.number().int().positive().optional(),
  compare: z.enum(['true']).optional(), // compare with the immediately preceding equal-length window
});
const n = (v: unknown) => Number(v ?? 0);

// Records-in-window predicate (checked_in_at within [from, to] inclusive, and an
// optional service filter joined via the event).
function inWindow(from: string, to: string, serviceTypeId?: number): SQL {
  const svc = serviceTypeId ? sql`AND ae.service_type_id = ${serviceTypeId}` : sql``;
  return sql`ar.checked_in_at >= ${from}::date AND ar.checked_in_at < (${to}::date + interval '1 day') ${svc}`;
}

async function summaryFor(from: string, to: string, serviceTypeId?: number) {
  const where = inWindow(from, to, serviceTypeId);
  const [row] = (await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(distinct ar.person_id)::int AS unique_people,
      count(distinct ar.attendance_event_id)::int AS events
    FROM attendance_records ar
    JOIN attendance_events ae ON ae.id = ar.attendance_event_id
    WHERE ${where}
  `)).rows;
  // First-timers = people whose FIRST-EVER check-in (optionally to this service)
  // falls inside the window.
  const svc = serviceTypeId ? sql`AND ae.service_type_id = ${serviceTypeId}` : sql``;
  const [ft] = (await db.execute(sql`
    SELECT count(*)::int AS first_timers FROM (
      SELECT ar.person_id, min(ar.checked_in_at) AS first_seen
      FROM attendance_records ar JOIN attendance_events ae ON ae.id = ar.attendance_event_id
      WHERE true ${svc}
      GROUP BY ar.person_id
    ) t WHERE t.first_seen >= ${from}::date AND t.first_seen < (${to}::date + interval '1 day')
  `)).rows;
  const total = n(row?.total), events = n(row?.events);
  return { total, uniquePeople: n(row?.unique_people), events, avgPerEvent: events ? Math.round((total / events) * 10) / 10 : 0, firstTimers: n(ft?.first_timers) };
}

analyticsRouter.get('/attendance', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const q = rangeQuery.parse(req.query);
  const svc = q.serviceTypeId ? sql`AND ae.service_type_id = ${q.serviceTypeId}` : sql``;

  const summary = await summaryFor(q.from, q.to, q.serviceTypeId);

  // Weekly trend within the window (total + unique).
  const trend = (await db.execute(sql`
    SELECT to_char(date_trunc('week', ar.checked_in_at), 'Mon DD') AS label,
           count(*)::int AS count, count(distinct ar.person_id)::int AS unique_count
    FROM attendance_records ar JOIN attendance_events ae ON ae.id = ar.attendance_event_id
    WHERE ${inWindow(q.from, q.to, q.serviceTypeId)}
    GROUP BY date_trunc('week', ar.checked_in_at)
    ORDER BY date_trunc('week', ar.checked_in_at)
  `)).rows.map((r) => ({ label: String(r.label), count: n(r.count), unique: n(r.unique_count) }));

  // Per-service breakdown within the window.
  const byService = (await db.execute(sql`
    SELECT ae.service_type_id AS id, coalesce(st.name->>'en', 'General') AS label,
           count(*)::int AS total, count(distinct ar.person_id)::int AS unique_people,
           count(distinct ar.attendance_event_id)::int AS events
    FROM attendance_records ar
    JOIN attendance_events ae ON ae.id = ar.attendance_event_id
    LEFT JOIN service_types st ON st.id = ae.service_type_id
    WHERE ar.checked_in_at >= ${q.from}::date AND ar.checked_in_at < (${q.to}::date + interval '1 day') ${svc}
    GROUP BY ae.service_type_id, st.name
    ORDER BY total DESC
  `)).rows.map((r) => ({ id: r.id == null ? null : n(r.id), label: String(r.label), total: n(r.total), unique: n(r.unique_people), events: n(r.events), avg: n(r.events) ? Math.round((n(r.total) / n(r.events)) * 10) / 10 : 0 }));

  const data: Record<string, unknown> = { summary, trend, byService };

  // Optional comparison with the immediately preceding, equal-length window.
  if (q.compare === 'true') {
    const fromD = new Date(q.from + 'T00:00:00Z'), toD = new Date(q.to + 'T00:00:00Z');
    const days = Math.round((+toD - +fromD) / 86400000) + 1;
    const prevTo = new Date(fromD); prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    data.compare = { from: iso(prevFrom), to: iso(prevTo), summary: await summaryFor(iso(prevFrom), iso(prevTo), q.serviceTypeId) };
  }

  res.json({ data });
}));

// Actionable people lists for follow-up. Returns ids + contact so the UI can
// message the exact list (e.g. first-timers a welcome, absentees a "we miss you").
const peopleQuery = z.object({
  bucket: z.enum(['first-timers', 'absentees', 'attendees']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  serviceTypeId: z.coerce.number().int().positive().optional(),
  weeks: z.coerce.number().int().min(1).max(104).optional(), // absentees threshold
});

analyticsRouter.get('/attendance/people', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const q = peopleQuery.parse(req.query);
  const svc = q.serviceTypeId ? sql`AND ae.service_type_id = ${q.serviceTypeId}` : sql``;
  const base = sql`p.given_name AS given_name, p.family_name AS family_name, p.email, p.mobile, p.id`;
  let rows;

  if (q.bucket === 'absentees') {
    const weeks = q.weeks ?? 4;
    rows = (await db.execute(sql`
      SELECT ${base}, (SELECT max(ar.checked_in_at) FROM attendance_records ar WHERE ar.person_id = p.id) AS last_seen
      FROM people p
      WHERE p.deleted_at IS NULL AND p.is_active = true
        AND EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.person_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.person_id = p.id AND ar.checked_in_at >= now() - (${weeks} * interval '1 week'))
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 500
    `)).rows;
  } else if (q.bucket === 'first-timers') {
    const from = q.from!, to = q.to!;
    rows = (await db.execute(sql`
      SELECT ${base}, t.first_seen AS last_seen FROM (
        SELECT ar.person_id, min(ar.checked_in_at) AS first_seen
        FROM attendance_records ar JOIN attendance_events ae ON ae.id = ar.attendance_event_id
        WHERE true ${svc}
        GROUP BY ar.person_id
      ) t JOIN people p ON p.id = t.person_id
      WHERE p.deleted_at IS NULL AND t.first_seen >= ${from}::date AND t.first_seen < (${to}::date + interval '1 day')
      ORDER BY t.first_seen DESC
      LIMIT 500
    `)).rows;
  } else {
    const from = q.from!, to = q.to!;
    rows = (await db.execute(sql`
      SELECT ${base}, max(ar.checked_in_at) AS last_seen, count(*)::int AS times
      FROM attendance_records ar
      JOIN attendance_events ae ON ae.id = ar.attendance_event_id
      JOIN people p ON p.id = ar.person_id
      WHERE p.deleted_at IS NULL AND ar.checked_in_at >= ${from}::date AND ar.checked_in_at < (${to}::date + interval '1 day') ${svc}
      GROUP BY p.id
      ORDER BY last_seen DESC
      LIMIT 500
    `)).rows;
  }

  res.json({ data: rows.map((r) => ({
    id: n(r.id), givenName: r.given_name, familyName: r.family_name,
    email: r.email ?? null, mobile: r.mobile ?? null,
    lastSeen: r.last_seen ?? null, times: r.times != null ? n(r.times) : undefined,
  })) });
}));

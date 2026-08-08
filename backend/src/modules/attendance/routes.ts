import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { attendanceEvents, attendanceRecords, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const eventSchema = z.object({
  title: z.record(z.string()).default({}),
  serviceTypeId: z.number().int().positive().nullable().optional(),
  startsAt: z.string(),
});

attendanceRouter.get('/events', requirePermission('view attendance'), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(attendanceEvents).orderBy(desc(attendanceEvents.startsAt)).limit(200);
  res.json({ data: rows });
}));

attendanceRouter.post('/events', requirePermission('create attendance'), asyncHandler(async (req, res) => {
  const b = eventSchema.parse(req.body);
  const [row] = await db.insert(attendanceEvents).values({ title: b.title, serviceTypeId: b.serviceTypeId ?? null, startsAt: new Date(b.startsAt) }).returning();
  await logActivity(req, 'created', 'attendance_event', row!.id);
  res.status(201).json({ data: row });
}));

/**
 * Recurring gatherings (#19): create a whole series in one call — e.g. every
 * Sunday for a term. Each occurrence is a normal attendance_events row (no
 * schema change), so it can be edited or deleted individually afterwards.
 * Intervals are computed from the first occurrence; `count` is capped to keep
 * one request bounded.
 */
const recurringSchema = z.object({
  title: z.record(z.string()).default({}),
  serviceTypeId: z.number().int().positive().nullable().optional(),
  startsAt: z.string(),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  count: z.number().int().min(2).max(52),
});

attendanceRouter.post('/events/recurring', requirePermission('create attendance'), asyncHandler(async (req, res) => {
  const b = recurringSchema.parse(req.body);
  const first = new Date(b.startsAt);
  if (Number.isNaN(first.getTime())) throw badRequest('Invalid start date');

  const rows = Array.from({ length: b.count }, (_, i) => {
    const d = new Date(first);
    if (b.frequency === 'monthly') {
      // Clamp to the target month's length so a day-31 start doesn't overflow
      // into the next month (JS setMonth quirk): Jan 31 +1mo -> Feb 28, not Mar 3.
      d.setDate(1);
      d.setMonth(first.getMonth() + i);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(first.getDate(), lastDay));
    } else {
      d.setDate(first.getDate() + i * (b.frequency === 'weekly' ? 7 : b.frequency === 'biweekly' ? 14 : 1));
    }
    return { title: b.title, serviceTypeId: b.serviceTypeId ?? null, startsAt: d };
  });

  const created = await db.insert(attendanceEvents).values(rows).returning();
  await logActivity(req, 'created', 'attendance_event', created[0]!.id, `recurring ${b.frequency} ×${created.length}`);
  res.status(201).json({ data: { count: created.length, first: created[0], events: created } });
}));

attendanceRouter.get('/events/:id', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const [row] = await db.select().from(attendanceEvents).where(eq(attendanceEvents.id, Number(req.params.id))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

// Rename / reschedule a gathering (not delete — that's Super-Admin only below).
attendanceRouter.put('/events/:id', requirePermission('update attendance'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = eventSchema.partial().parse(req.body);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (b.title !== undefined) patch.title = b.title;
  if (b.serviceTypeId !== undefined) patch.serviceTypeId = b.serviceTypeId ?? null;
  if (b.startsAt !== undefined) patch.startsAt = new Date(b.startsAt);
  const [row] = await db.update(attendanceEvents).set(patch).where(eq(attendanceEvents.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'attendance_event', id);
  res.json({ data: row });
}));

// Delete a gathering (and its attendance records, via FK cascade). Restricted to
// Super Admin — a deliberately high bar, matched by a two-step confirm in the UI.
attendanceRouter.delete('/events/:id', requireRole('Super Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(attendanceEvents).where(eq(attendanceEvents.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'attendance_event', id);
  res.status(204).end();
}));

attendanceRouter.get('/events/:id/records', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const eventId = Number(req.params.id);
  const rows = await db
    .select({
      id: attendanceRecords.id,
      personId: attendanceRecords.personId,
      checkedInAt: attendanceRecords.checkedInAt,
      givenName: people.givenName,
      familyName: people.familyName,
      // For the new-vs-member filter on the attendee list.
      membershipStatus: people.membershipStatus,
      selfRegistered: people.selfRegistered,
    })
    .from(attendanceRecords)
    .innerJoin(people, eq(people.id, attendanceRecords.personId))
    .where(eq(attendanceRecords.attendanceEventId, eventId))
    .orderBy(desc(attendanceRecords.checkedInAt));
  res.json({ data: rows });
}));

// Idempotent per (event, person): the unique index + onConflictDoNothing means a
// second scan is a harmless no-op (returns undefined).
async function record(eventId: number, personId: number, userId: number | null) {
  const [row] = await db
    .insert(attendanceRecords)
    .values({ attendanceEventId: eventId, personId, recordedBy: userId })
    .onConflictDoNothing()
    .returning();
  return row;
}

attendanceRouter.post('/events/:id/records', requirePermission('create attendance'), asyncHandler(async (req, res) => {
  const eventId = Number(req.params.id);
  const personId = z.object({ personId: z.number().int().positive() }).parse(req.body).personId;
  const row = await record(eventId, personId, req.auth!.sub);
  res.status(201).json({ data: row ?? { attendanceEventId: eventId, personId, duplicate: true } });
}));

// Kiosk / QR check-in: resolve the person by their QR token, then record.
attendanceRouter.post('/checkin', requirePermission('create attendance'), asyncHandler(async (req, res) => {
  const { eventId, qrToken } = z.object({ eventId: z.number().int().positive(), qrToken: z.string().uuid() }).parse(req.body);
  const [event] = await db.select({ id: attendanceEvents.id }).from(attendanceEvents).where(eq(attendanceEvents.id, eventId)).limit(1);
  if (!event) throw notFound('Event not found');
  const [person] = await db.select().from(people).where(eq(people.qrToken, qrToken)).limit(1);
  if (!person) throw badRequest('Unknown code');
  const row = await record(eventId, person.id, req.auth!.sub);
  res.status(201).json({ data: { person: { id: person.id, givenName: person.givenName, familyName: person.familyName }, recorded: !!row } });
}));

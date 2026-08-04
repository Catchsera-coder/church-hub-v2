import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { attendanceEvents, attendanceRecords, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
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

attendanceRouter.get('/events/:id/records', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const eventId = Number(req.params.id);
  const rows = await db
    .select({
      id: attendanceRecords.id,
      personId: attendanceRecords.personId,
      checkedInAt: attendanceRecords.checkedInAt,
      givenName: people.givenName,
      familyName: people.familyName,
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

import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { conferences, conferenceRegistrants, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const eventsRouter = Router();
eventsRouter.use(authenticate);

const schema = z.object({
  name: z.record(z.string()).default({}),
  startsOn: z.string(),
  endsOn: z.string().nullable().optional(),
  venue: z.string().max(190).nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  fee: z.number().nonnegative().nullable().optional(), // major units → stored minor
  registrationOpen: z.boolean().default(true),
});

function toRow(b: z.infer<typeof schema>) {
  return {
    name: b.name,
    startsOn: b.startsOn,
    endsOn: b.endsOn ?? null,
    venue: b.venue ?? null,
    capacity: b.capacity ?? null,
    feeAmountMinor: b.fee === null || b.fee === undefined ? null : Math.round(b.fee * 100),
    registrationOpen: b.registrationOpen,
  };
}

eventsRouter.get('/', requirePermission('view event'), asyncHandler(async (_req, res) => {
  const rows = await db
    .select({
      id: conferences.id,
      name: conferences.name,
      startsOn: conferences.startsOn,
      endsOn: conferences.endsOn,
      venue: conferences.venue,
      capacity: conferences.capacity,
      feeAmountMinor: conferences.feeAmountMinor,
      registrationOpen: conferences.registrationOpen,
      registrants: sql<number>`(select count(*)::int from ${conferenceRegistrants} r where r.conference_id = ${conferences.id})`,
    })
    .from(conferences)
    .orderBy(desc(conferences.startsOn));
  res.json({ data: rows });
}));

eventsRouter.post('/', requirePermission('create event'), asyncHandler(async (req, res) => {
  const [row] = await db.insert(conferences).values(toRow(schema.parse(req.body))).returning();
  await logActivity(req, 'created', 'event', row!.id);
  res.status(201).json({ data: row });
}));

eventsRouter.put('/:id', requirePermission('update event'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(conferences).set({ ...toRow(schema.parse(req.body)), updatedAt: new Date() }).where(eq(conferences.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'event', id);
  res.json({ data: row });
}));

eventsRouter.get('/:id/registrants', requirePermission('view event'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select({ id: conferenceRegistrants.id, personId: people.id, givenName: people.givenName, familyName: people.familyName, role: conferenceRegistrants.role, roleNote: conferenceRegistrants.roleNote, registeredAt: conferenceRegistrants.registeredAt })
    .from(conferenceRegistrants)
    .innerJoin(people, eq(people.id, conferenceRegistrants.personId))
    .where(eq(conferenceRegistrants.conferenceId, id))
    .orderBy(desc(conferenceRegistrants.registeredAt));
  res.json({ data: rows });
}));

const registrantSchema = z.object({
  personId: z.number().int().positive(),
  role: z.enum(['attendee', 'guest', 'speaker', 'singer', 'musician', 'free', 'other']).default('attendee'),
  roleNote: z.string().max(120).nullable().optional(),
});

eventsRouter.post('/:id/registrants', requirePermission('update event'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = registrantSchema.parse(req.body);
  const [event] = await db.select().from(conferences).where(eq(conferences.id, id)).limit(1);
  if (!event) throw notFound();
  if (!event.registrationOpen) throw badRequest('Registration is closed for this event');
  const [row] = await db
    .insert(conferenceRegistrants)
    .values({ conferenceId: id, personId: b.personId, role: b.role, roleNote: b.role === 'other' ? (b.roleNote ?? null) : null })
    .onConflictDoNothing()
    .returning();
  res.status(201).json({ data: row ?? { conferenceId: id, personId: b.personId, duplicate: true } });
}));

eventsRouter.delete('/:id/registrants/:registrantId', requirePermission('update event'), asyncHandler(async (req, res) => {
  await db.delete(conferenceRegistrants).where(eq(conferenceRegistrants.id, Number(req.params.registrantId)));
  res.status(204).end();
}));

import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { serviceTypes, personServiceType, people, servingAssignments, personClearances } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { currentOrg } from '../settings/routes.js';
import { resolveMessaging, sendMessage } from '../messages/delivery.js';

export const ministriesRouter = Router();
ministriesRouter.use(authenticate);

const streamingSchema = z.object({
  mode: z.enum(['manual', 'youtube']),
  url: z.string().max(500).optional(),
  youtube: z.string().max(120).optional(),
}).nullable().optional();

const schema = z.object({
  name: z.record(z.string()).default({}),
  description: z.record(z.string()).default({}),
  ageGroup: z.enum(['children', 'youth', 'adult']).nullable().optional(),
  defaultSchedule: z.string().max(120).nullable().optional(),
  streaming: streamingSchema,
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  // Tier A/C structure
  kind: z.enum(['ministry', 'group']).default('ministry'),
  category: z.string().max(40).nullable().optional(),
  leaderId: z.number().int().positive().nullable().optional(),
  contactEmail: z.union([z.string().email().max(190), z.literal('')]).nullable().optional(),
  location: z.string().max(190).nullable().optional(),
  meetingDay: z.string().max(20).nullable().optional(),
  meetingTime: z.string().max(20).nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  openToSignup: z.boolean().default(false),
});

// A member's clearance is "ok" if they have any clearance that is valid and not
// past its expiry (null expiry = never expires). Used to warn when rostering
// someone into a children/youth ministry.
const clearanceOkExpr = sql<boolean>`EXISTS (SELECT 1 FROM ${personClearances} pc WHERE pc.person_id = ${people.id}
  AND pc.status = 'valid' AND (pc.expires_on IS NULL OR pc.expires_on >= current_date))`;

// Count roster members per ministry. NOTE: correlate via the literal table name
// (service_types.id), never an interpolated column — Drizzle renders a primary
// FROM-table column unqualified and it would bind to the subquery instead.
const memberCountExpr = sql<number>`(SELECT count(*)::int FROM ${personServiceType} pst WHERE pst.service_type_id = service_types.id)`;

ministriesRouter.get('/', requirePermission('view ministry'), asyncHandler(async (req, res) => {
  const kind = z.enum(['ministry', 'group']).optional().parse(req.query.kind);
  const rows = await db
    .select({
      id: serviceTypes.id, name: serviceTypes.name, description: serviceTypes.description,
      ageGroup: serviceTypes.ageGroup, defaultSchedule: serviceTypes.defaultSchedule,
      streaming: serviceTypes.streaming, parentId: serviceTypes.parentId, sortOrder: serviceTypes.sortOrder,
      isActive: serviceTypes.isActive, kind: serviceTypes.kind, category: serviceTypes.category,
      leaderId: serviceTypes.leaderId, contactEmail: serviceTypes.contactEmail, location: serviceTypes.location,
      meetingDay: serviceTypes.meetingDay, meetingTime: serviceTypes.meetingTime, capacity: serviceTypes.capacity,
      openToSignup: serviceTypes.openToSignup, publicToken: serviceTypes.publicToken,
      memberCount: memberCountExpr,
      leaderName: sql<string | null>`(SELECT trim(COALESCE(p.given_name->>'en','') || ' ' || COALESCE(p.family_name->>'en','')) FROM ${people} p WHERE p.id = service_types.leader_id)`,
    })
    .from(serviceTypes)
    .where(and(isNull(serviceTypes.deletedAt), kind ? eq(serviceTypes.kind, kind) : undefined))
    .orderBy(asc(serviceTypes.sortOrder));
  res.json({ data: rows });
}));

ministriesRouter.get('/:id', requirePermission('view ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(serviceTypes).where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt))).limit(1);
  if (!row) throw notFound();
  let leader = null;
  if (row.leaderId) {
    const [l] = await db.select({ id: people.id, givenName: people.givenName, familyName: people.familyName, email: people.email, mobile: people.mobile })
      .from(people).where(eq(people.id, row.leaderId)).limit(1);
    leader = l ?? null;
  }
  res.json({ data: { ...row, leader } });
}));

ministriesRouter.post('/', requirePermission('create ministry'), asyncHandler(async (req, res) => {
  const body = normalise(schema.parse(req.body));
  const [row] = await db.insert(serviceTypes).values(body).returning();
  await logActivity(req, 'created', 'ministry', row!.id);
  res.status(201).json({ data: row });
}));

ministriesRouter.put('/:id', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = normalise(schema.partial().parse(req.body));
  if (body.parentId === id) throw badRequest('A ministry cannot be its own parent');
  const [row] = await db.update(serviceTypes).set({ ...body, updatedAt: new Date() }).where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'ministry', id);
  res.json({ data: row });
}));

ministriesRouter.delete('/:id', requirePermission('delete ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(serviceTypes).set({ deletedAt: new Date() }).where(and(eq(serviceTypes.id, id), isNull(serviceTypes.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'ministry', id);
  res.status(204).end();
}));

// Coerce '' contactEmail to null so the empty form field doesn't fail email check downstream.
function normalise<T extends Record<string, unknown>>(b: T): T {
  const out: Record<string, unknown> = { ...b };
  if (out.contactEmail === '') out.contactEmail = null;
  return out as T;
}

// --- Roster (person ↔ ministry with role/status) -----------------------------
const ROSTER_ROLES = ['leader', 'coordinator', 'volunteer', 'member'] as const;

ministriesRouter.get('/:id/members', requirePermission('view ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select({
      id: people.id, givenName: people.givenName, familyName: people.familyName,
      email: people.email, mobile: people.mobile, membershipStatus: people.membershipStatus,
      skills: people.skills,
      role: personServiceType.role, status: personServiceType.status,
      servingSince: personServiceType.servingSince, notes: personServiceType.notes,
      clearanceOk: clearanceOkExpr,
    })
    .from(personServiceType)
    .innerJoin(people, eq(people.id, personServiceType.personId))
    .where(and(eq(personServiceType.serviceTypeId, id), isNull(people.deletedAt)))
    // leaders first, then coordinators, volunteers, members; then by name.
    .orderBy(sql`CASE ${personServiceType.role} WHEN 'leader' THEN 0 WHEN 'coordinator' THEN 1 WHEN 'volunteer' THEN 2 ELSE 3 END`, asc(people.id));
  res.json({ data: rows });
}));

ministriesRouter.post('/:id/members', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({
    personId: z.number().int().positive(),
    role: z.enum(ROSTER_ROLES).default('member'),
    status: z.enum(['active', 'paused']).default('active'),
    servingSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).parse(req.body);
  const [person] = await db.select({ id: people.id }).from(people).where(and(eq(people.id, body.personId), isNull(people.deletedAt))).limit(1);
  if (!person) throw notFound('Person not found');
  await db.insert(personServiceType)
    .values({ serviceTypeId: id, personId: body.personId, role: body.role, status: body.status, servingSince: body.servingSince ?? null })
    .onConflictDoUpdate({ target: [personServiceType.personId, personServiceType.serviceTypeId], set: { role: body.role, status: body.status, updatedAt: new Date() } });
  await logActivity(req, 'updated', 'ministry', id, 'roster-add');
  res.status(201).json({ data: { ok: true } });
}));

ministriesRouter.put('/:id/members/:personId', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const personId = Number(req.params.personId);
  const body = z.object({
    role: z.enum(ROSTER_ROLES).optional(),
    status: z.enum(['active', 'paused']).optional(),
    servingSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  const [row] = await db.update(personServiceType).set({ ...body, updatedAt: new Date() })
    .where(and(eq(personServiceType.serviceTypeId, id), eq(personServiceType.personId, personId))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'ministry', id, 'roster-update');
  res.json({ data: { ok: true } });
}));

ministriesRouter.delete('/:id/members/:personId', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const personId = Number(req.params.personId);
  await db.delete(personServiceType).where(and(eq(personServiceType.serviceTypeId, id), eq(personServiceType.personId, personId)));
  await logActivity(req, 'updated', 'ministry', id, 'roster-remove');
  res.status(204).end();
}));

// Serving anniversaries this (or a given) month — people whose servingSince falls
// in the month, in a previous year. Used for recognition.
ministriesRouter.get('/:id/anniversaries', requirePermission('view ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const month = req.query.month ? Number(req.query.month) : null; // 1-12; default current
  const monthExpr = month ? sql`${month}` : sql`extract(month from current_date)`;
  const rows = await db
    .select({
      id: people.id, givenName: people.givenName, familyName: people.familyName,
      servingSince: personServiceType.servingSince, role: personServiceType.role,
      years: sql<number>`(extract(year from current_date) - extract(year from ${personServiceType.servingSince}))::int`,
    })
    .from(personServiceType)
    .innerJoin(people, eq(people.id, personServiceType.personId))
    .where(and(
      eq(personServiceType.serviceTypeId, id), isNull(people.deletedAt),
      sql`${personServiceType.servingSince} IS NOT NULL`,
      sql`extract(month from ${personServiceType.servingSince}) = ${monthExpr}`,
      sql`extract(year from ${personServiceType.servingSince}) < extract(year from current_date)`,
    ));
  res.json({ data: rows });
}));

// --- Serving rota (assignments) ---------------------------------------------
ministriesRouter.get('/:id/assignments', requirePermission('view ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { from, to } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.query);
  const rows = await db
    .select({
      id: servingAssignments.id, personId: servingAssignments.personId,
      serveDate: servingAssignments.serveDate, role: servingAssignments.role,
      status: servingAssignments.status, reminderSentAt: servingAssignments.reminderSentAt,
      notes: servingAssignments.notes,
      givenName: people.givenName, familyName: people.familyName, mobile: people.mobile, email: people.email,
    })
    .from(servingAssignments)
    .innerJoin(people, eq(people.id, servingAssignments.personId))
    .where(and(
      eq(servingAssignments.serviceTypeId, id),
      from ? gte(servingAssignments.serveDate, from) : undefined,
      to ? lte(servingAssignments.serveDate, to) : undefined,
    ))
    .orderBy(asc(servingAssignments.serveDate), asc(servingAssignments.role));
  res.json({ data: rows });
}));

ministriesRouter.post('/:id/assignments', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({
    personId: z.number().int().positive(),
    serveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    role: z.string().max(60).nullable().optional(),
    attendanceEventId: z.number().int().positive().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  const [row] = await db.insert(servingAssignments).values({ serviceTypeId: id, ...body }).returning();
  await logActivity(req, 'created', 'ministry', id, 'rota');
  res.status(201).json({ data: row });
}));

ministriesRouter.put('/:id/assignments/:aid', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const aid = Number(req.params.aid);
  const body = z.object({
    status: z.enum(['invited', 'confirmed', 'declined']).optional(),
    role: z.string().max(60).nullable().optional(),
    serveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).parse(req.body);
  const [row] = await db.update(servingAssignments).set({ ...body, updatedAt: new Date() }).where(eq(servingAssignments.id, aid)).returning();
  if (!row) throw notFound();
  res.json({ data: row });
}));

ministriesRouter.delete('/:id/assignments/:aid', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  await db.delete(servingAssignments).where(eq(servingAssignments.id, Number(req.params.aid)));
  res.status(204).end();
}));

// Send a serving reminder to everyone rostered for a ministry on a given date.
// Honest: only counts a send when the channel actually accepts it. Email-first,
// SMS fallback. Sets reminderSentAt on success.
ministriesRouter.post('/:id/assignments/remind', requirePermission('update ministry'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { serveDate } = z.object({ serveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  const [ministry] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, id)).limit(1);
  if (!ministry) throw notFound();
  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });

  const rows = await db
    .select({
      id: servingAssignments.id, role: servingAssignments.role,
      email: people.email, mobile: people.mobile, preferredLanguage: people.preferredLanguage,
      emailOptOut: people.emailOptOut, smsOptOut: people.smsOptOut,
      given: people.givenName,
    })
    .from(servingAssignments)
    .innerJoin(people, eq(people.id, servingAssignments.personId))
    .where(and(eq(servingAssignments.serviceTypeId, id), eq(servingAssignments.serveDate, serveDate), isNull(people.deletedAt)));

  const mName = (ministry.name as Record<string, string>)?.en || 'ministry';
  let sent = 0;
  for (const r of rows) {
    const lang = r.preferredLanguage || 'en';
    const first = (r.given as Record<string, string>)?.[lang] || (r.given as Record<string, string>)?.en || '';
    const roleLine = r.role ? ` as ${r.role}` : '';
    const subject = `Serving reminder — ${mName}`;
    const text = `Hi ${first},\n\nThis is a reminder that you're serving in ${mName}${roleLine} on ${serveDate}.\n\nThank you for serving!`;
    let ok = false;
    if (r.email && !r.emailOptOut) ok = await sendMessage(messaging, 'email', r.email, subject, text);
    else if (r.mobile && !r.smsOptOut) ok = await sendMessage(messaging, 'sms', r.mobile, subject, text);
    if (ok) { sent++; await db.update(servingAssignments).set({ reminderSentAt: new Date() }).where(eq(servingAssignments.id, r.id)); }
  }
  await logActivity(req, 'updated', 'ministry', id, 'rota-remind');
  res.json({ data: { sent, total: rows.length } });
}));

import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, personServiceType, serviceTypes, attendanceRecords, automations, messageTemplates } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendTemplateToPerson, resolveMessaging } from '../automations/service.js';
import { currentOrg } from '../settings/routes.js';

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
  joinedOn: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  emailOptOut: z.boolean().optional(),
  smsOptOut: z.boolean().optional(),
  whatsappOptOut: z.boolean().optional(),
  customFields: z.record(z.string()).optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  status: z.enum(['visitor', 'regular', 'member', 'inactive']).optional(),
  // 'pending' → people who self-registered and haven't been vetted by staff yet.
  review: z.enum(['pending']).optional(),
  // Pastor/servant filters (all optional, combinable).
  ageGroup: z.enum(['child', 'youth', 'adult']).optional(),   // derived from DOB
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  anniversaryMonth: z.coerce.number().int().min(1).max(12).optional(), // joined-on month
  ministryId: z.coerce.number().int().positive().optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  hasPhone: z.enum(['true', 'false']).optional(),
  optedIn: z.enum(['email', 'sms', 'whatsapp']).optional(),
  missingContact: z.enum(['true']).optional(),
  inactiveWeeks: z.coerce.number().int().min(1).max(104).optional(),
});

// GET /api/people — paginated, searchable across both locales of the name.
peopleRouter.get(
  '/',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const { page, limit, search, status, review } = q;
    const filters = [isNull(people.deletedAt)];
    if (status) filters.push(eq(people.membershipStatus, status));
    if (review === 'pending') filters.push(eq(people.selfRegistered, true), isNull(people.reviewedAt));
    if (search) {
      const like = `%${search}%`;
      filters.push(
        sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
          OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like}
          OR ${people.email} ILIKE ${like} OR ${people.mobile} ILIKE ${like})`,
      );
    }
    // Age bucket from date of birth (child <13, youth 13–17, adult ≥18).
    if (q.ageGroup === 'child') filters.push(sql`${people.dateOfBirth} IS NOT NULL AND extract(year from age(${people.dateOfBirth})) < 13`);
    if (q.ageGroup === 'youth') filters.push(sql`extract(year from age(${people.dateOfBirth})) BETWEEN 13 AND 17`);
    if (q.ageGroup === 'adult') filters.push(sql`extract(year from age(${people.dateOfBirth})) >= 18`);
    if (q.birthdayMonth) filters.push(sql`extract(month from ${people.dateOfBirth}) = ${q.birthdayMonth}`);
    if (q.anniversaryMonth) filters.push(sql`extract(month from ${people.joinedOn}) = ${q.anniversaryMonth}`);
    if (q.ministryId) filters.push(sql`EXISTS (SELECT 1 FROM ${personServiceType} pst WHERE pst.person_id = ${people.id} AND pst.service_type_id = ${q.ministryId})`);
    if (q.hasEmail === 'true') filters.push(sql`${people.email} IS NOT NULL AND ${people.email} <> ''`);
    if (q.hasEmail === 'false') filters.push(sql`(${people.email} IS NULL OR ${people.email} = '')`);
    if (q.hasPhone === 'true') filters.push(sql`${people.mobile} IS NOT NULL AND ${people.mobile} <> ''`);
    if (q.hasPhone === 'false') filters.push(sql`(${people.mobile} IS NULL OR ${people.mobile} = '')`);
    if (q.missingContact === 'true') filters.push(sql`(${people.email} IS NULL OR ${people.email} = '') AND (${people.mobile} IS NULL OR ${people.mobile} = '')`);
    // Opted-in on a channel = opt-out false AND the relevant contact present.
    if (q.optedIn === 'email') filters.push(sql`${people.emailOptOut} = false AND ${people.email} IS NOT NULL AND ${people.email} <> ''`);
    if (q.optedIn === 'sms') filters.push(sql`${people.smsOptOut} = false AND ${people.mobile} IS NOT NULL AND ${people.mobile} <> ''`);
    if (q.optedIn === 'whatsapp') filters.push(sql`${people.whatsappOptOut} = false AND ${people.mobile} IS NOT NULL AND ${people.mobile} <> ''`);
    // No attendance in the last N weeks (follow-up list).
    if (q.inactiveWeeks) filters.push(sql`NOT EXISTS (SELECT 1 FROM ${attendanceRecords} ar WHERE ar.person_id = ${people.id} AND ar.checked_in_at >= now() - (${q.inactiveWeeks} * interval '1 week'))`);
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

// Mark a self-registered person as reviewed (clears them from the review queue).
// Optionally promote their membership status in the same call.
peopleRouter.post(
  '/:id/review',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { membershipStatus, sendWelcome } = z
      .object({
        membershipStatus: z.enum(['visitor', 'regular', 'member', 'inactive']).optional(),
        sendWelcome: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const [row] = await db
      .update(people)
      .set({ reviewedAt: new Date(), ...(membershipStatus ? { membershipStatus } : {}), updatedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt)))
      .returning();
    if (!row) throw notFound();
    await logActivity(req, 'updated', 'person', id, 'reviewed');

    // Optional branded welcome via the "welcome" automation's template + channel.
    let welcomeSent = false;
    if (sendWelcome) {
      const [wa] = await db.select().from(automations).where(eq(automations.type, 'welcome')).limit(1);
      if (wa?.templateId) {
        const org = await currentOrg();
        const messaging = resolveMessaging(org.messaging);
        welcomeSent = await sendTemplateToPerson(row as never, wa.channel as 'email' | 'sms' | 'whatsapp',
          (await db.select().from(messageTemplates).where(eq(messageTemplates.id, wa.templateId)).limit(1))[0] ?? {}, org, messaging);
      }
    }
    res.json({ data: row, welcomeSent });
  }),
);

// --- Ministry roster (person ↔ service type) ---------------------------------
// The set of ministries a person serves in. GET lists them; PUT replaces the
// whole set in one call (simpler and race-free vs add/remove endpoints).
peopleRouter.get(
  '/:id/ministries',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const personId = Number(req.params.id);
    const rows = await db
      .select({ id: serviceTypes.id, name: serviceTypes.name })
      .from(personServiceType)
      .innerJoin(serviceTypes, eq(serviceTypes.id, personServiceType.serviceTypeId))
      .where(eq(personServiceType.personId, personId));
    res.json({ data: rows });
  }),
);

peopleRouter.put(
  '/:id/ministries',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const personId = Number(req.params.id);
    const { serviceTypeIds } = z.object({ serviceTypeIds: z.array(z.number().int().positive()).default([]) }).parse(req.body);
    const [person] = await db.select({ id: people.id }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).limit(1);
    if (!person) throw notFound();
    await db.delete(personServiceType).where(eq(personServiceType.personId, personId));
    if (serviceTypeIds.length) {
      await db.insert(personServiceType)
        .values(serviceTypeIds.map((serviceTypeId) => ({ personId, serviceTypeId })))
        .onConflictDoNothing();
    }
    await logActivity(req, 'updated', 'person', personId, 'roster');
    res.json({ data: { serviceTypeIds } });
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

import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, personServiceType, serviceTypes, automations, messageTemplates } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendTemplateToPerson, resolveMessaging } from '../automations/service.js';
import { currentOrg } from '../settings/routes.js';
import { peopleListQuery, peopleFilters } from './filters.js';

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

// GET /api/people — paginated, searchable across both locales of the name.
peopleRouter.get(
  '/',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const q = peopleListQuery.parse(req.query);
    const { page, limit } = q;
    const where = and(...peopleFilters(q));
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

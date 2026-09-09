import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households, personServiceType, serviceTypes, automations, messageTemplates, personClearances, careItems } from '../../db/schema.js';
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
const addr = () => z.string().max(190).nullable().optional();
const upsertSchema = z.object({
  givenName: i18n,
  middleName: i18n,
  nickName: i18n,
  familyName: i18n,
  householdId: z.number().int().positive().nullable().optional(),
  // Optional per-person address (blank → inherits the family's).
  addressLine1: addr(),
  addressLine2: addr(),
  city: addr(),
  region: addr(),
  postalCode: z.string().max(20).nullable().optional(),
  country: addr(),
  householdRole: z.string().max(20).nullable().optional(),
  membershipStatus: z.enum(['visitor', 'regular', 'member', 'inactive']).default('visitor'),
  category: z.enum(['congregation', 'contact']).optional(),
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
  // Gifts / skills / interests (free tags) for ministry matching.
  skills: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  // Assimilation/follow-up pipeline stage.
  followUpStage: z.string().max(30).nullable().optional(),
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
    // All people columns PLUS the household name + city, so lists and pickers can
    // disambiguate common names ("Samy Ibrahim · Ibrahim family · Boston").
    const rows = await db
      .select({
        ...getTableColumns(people),
        householdName: sql<Record<string, string> | null>`(SELECT h.name FROM ${households} h WHERE h.id = people.household_id)`,
        householdCity: sql<string | null>`(SELECT h.city FROM ${households} h WHERE h.id = people.household_id)`,
      })
      .from(people)
      .where(where)
      .orderBy(desc(people.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({ data: rows, meta: { page, limit, total: count, pages: Math.ceil(count / limit) } });
  }),
);

// Duplicate guard: given a first + last name, return existing active people with
// the same name so the composer/create form can warn "3 people already named X".
// Non-blocking — it only surfaces matches; the user decides.
peopleRouter.get(
  '/duplicates',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const { given, family, exclude } = z.object({
      given: z.string().trim().min(1).max(80),
      family: z.string().trim().max(80).optional().default(''),
      exclude: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const g = `%${given}%`;
    const f = family ? `%${family}%` : null;
    const rows = await db
      .select({
        id: people.id, givenName: people.givenName, middleName: people.middleName, familyName: people.familyName,
        email: people.email, mobile: people.mobile,
        householdName: sql<Record<string, string> | null>`(SELECT h.name FROM ${households} h WHERE h.id = people.household_id)`,
        householdCity: sql<string | null>`(SELECT h.city FROM ${households} h WHERE h.id = people.household_id)`,
      })
      .from(people)
      .where(and(
        isNull(people.deletedAt), isNull(people.archivedAt),
        sql`(${people.givenName}->>'en' ILIKE ${g} OR ${people.givenName}->>'ar' ILIKE ${g})`,
        ...(f ? [sql`(${people.familyName}->>'en' ILIKE ${f} OR ${people.familyName}->>'ar' ILIKE ${f})`] : []),
        ...(exclude ? [ne(people.id, exclude)] : []),
      ))
      .limit(8);
    res.json({ data: rows });
  }),
);

// Safeguarding/document clearances expiring soon (or already lapsed) — powers the
// "expiry reminders" dashboard card so nobody serves on a lapsed check.
peopleRouter.get(
  '/clearances/expiring',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 45));
    const rows = await db.execute(sql`
      SELECT pc.id, pc.person_id, pc.type, pc.expires_on, p.given_name, p.family_name
      FROM person_clearances pc
      JOIN people p ON p.id = pc.person_id
      WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
        AND pc.expires_on IS NOT NULL
        AND pc.expires_on <= (current_date + (${days} || ' days')::interval)
        AND pc.status <> 'expired'
      ORDER BY pc.expires_on ASC
      LIMIT 100
    `);
    res.json({ data: rows.rows.map((r) => ({ id: Number(r.id), personId: Number(r.person_id), type: r.type, expiresOn: r.expires_on, givenName: r.given_name, familyName: r.family_name })) });
  }),
);

// "Needs attention" — people to re-engage: (a) LAPSED — had attendance but none
// in the last N weeks; or (b) STALE VISITOR — no attendance, still 'visitor', and
// first seen over a year ago (real firstVisitOn or the year-only provenance).
// Excludes contacts, archived, those already in the follow-up pipeline, and
// anyone currently snoozed. Ordered longest-absent first.
function reengagementWhere(weeks: number) {
  return sql`
    p.deleted_at IS NULL AND p.archived_at IS NULL AND p.category = 'congregation'
    AND p.follow_up_stage IS NULL
    AND (p.reengage_snoozed_until IS NULL OR p.reengage_snoozed_until < current_date)
    AND (
      (ls.last_at IS NOT NULL AND ls.last_at < now() - (${weeks} * interval '1 week'))
      OR (ls.last_at IS NULL AND p.membership_status = 'visitor' AND (
        (p.first_visit_on IS NOT NULL AND p.first_visit_on < current_date - interval '1 year')
        OR (p.custom_fields->>'firstSeenYear' ~ '^[0-9]{4}$' AND (p.custom_fields->>'firstSeenYear')::int <= extract(year from current_date)::int - 1)
      ))
    )`;
}
peopleRouter.get(
  '/reengagement',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const weeks = Math.min(104, Math.max(1, Number(req.query.weeks) || 8));
    const rows = await db.execute(sql`
      WITH ls AS (SELECT person_id, max(checked_in_at) AS last_at, count(*)::int AS visits FROM attendance_records GROUP BY person_id)
      SELECT p.id, p.given_name, p.family_name, p.middle_name, p.email, p.mobile, p.membership_status,
             p.first_visit_on, p.custom_fields->>'firstSeenYear' AS first_seen_year, p.custom_fields->>'sourceList' AS source_list,
             ls.last_at AS last_seen, coalesce(ls.visits, 0) AS visits,
             (SELECT h.name FROM households h WHERE h.id = p.household_id) AS household_name,
             CASE WHEN ls.last_at IS NOT NULL THEN 'lapsed' ELSE 'stale_visitor' END AS reason
      FROM people p LEFT JOIN ls ON ls.person_id = p.id
      WHERE ${reengagementWhere(weeks)}
      ORDER BY reason ASC, ls.last_at ASC NULLS LAST, p.first_visit_on ASC NULLS LAST
      LIMIT 500`);
    res.json({ data: rows.rows.map((r) => ({
      id: Number(r.id), givenName: r.given_name, familyName: r.family_name, middleName: r.middle_name,
      email: r.email, mobile: r.mobile, membershipStatus: r.membership_status,
      firstVisitOn: r.first_visit_on, firstSeenYear: r.first_seen_year, sourceList: r.source_list,
      lastSeen: r.last_seen, visits: Number(r.visits), householdName: r.household_name, reason: r.reason,
    })) });
  }),
);
peopleRouter.get(
  '/reengagement/count',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const weeks = Math.min(104, Math.max(1, Number(req.query.weeks) || 8));
    const r = await db.execute(sql`
      WITH ls AS (SELECT person_id, max(checked_in_at) AS last_at FROM attendance_records GROUP BY person_id)
      SELECT count(*)::int AS n FROM people p LEFT JOIN ls ON ls.person_id = p.id WHERE ${reengagementWhere(weeks)}`);
    res.json({ data: { count: Number(r.rows[0]?.n ?? 0) } });
  }),
);
// Snooze a person off the re-engagement list for 3 months (admin "Ignore").
peopleRouter.post(
  '/:id/snooze',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db.update(people)
      .set({ reengageSnoozedUntil: sql`current_date + interval '3 months'`, updatedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt))).returning();
    if (!row) throw notFound();
    await logActivity(req, 'updated', 'person', id, 're-engagement snoozed 3mo');
    res.json({ data: row });
  }),
);

// Bulk action on a set of people (from the "Needs attention" multi-select).
// snooze = hide 3 months; archive = move out of active lists; followup = enter the
// Follow-up pipeline (stage 'contacted') and, if a servant is chosen, create a
// pastoral-care task assigned to them for each person.
const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(2000),
  action: z.enum(['snooze', 'archive', 'followup']),
  assigneeUserId: z.number().int().positive().nullable().optional(),
});
peopleRouter.post(
  '/bulk',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const b = bulkSchema.parse(req.body);
    if (b.action === 'snooze') {
      await db.update(people).set({ reengageSnoozedUntil: sql`current_date + interval '3 months'`, updatedAt: new Date() }).where(inArray(people.id, b.ids));
    } else if (b.action === 'archive') {
      await db.update(people).set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() }).where(and(inArray(people.id, b.ids), isNull(people.deletedAt)));
    } else if (b.action === 'followup') {
      await db.update(people).set({ followUpStage: 'contacted', updatedAt: new Date() }).where(inArray(people.id, b.ids));
      if (b.assigneeUserId) {
        for (const pid of b.ids) {
          await db.insert(careItems).values({ type: 'task', subject: 'Re-engage — reach out and reconnect', personId: pid, assignedToUserId: b.assigneeUserId, status: 'open', createdByUserId: req.auth!.sub });
        }
      }
    }
    await logActivity(req, 'updated', 'person', 0, `bulk ${b.action}: ${b.ids.length}${b.assigneeUserId ? ` → user ${b.assigneeUserId}` : ''}`);
    res.json({ data: { affected: b.ids.length } });
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
        const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
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
    // Non-destructive: only remove ministries that were unchecked and add the new
    // ones (default role). Existing memberships keep their role/status/servingSince
    // so editing from the member profile never wipes a ministry role.
    const current = await db.select({ serviceTypeId: personServiceType.serviceTypeId }).from(personServiceType).where(eq(personServiceType.personId, personId));
    const currentIds = new Set(current.map((r) => r.serviceTypeId));
    const wanted = new Set(serviceTypeIds);
    const toRemove = [...currentIds].filter((x) => !wanted.has(x));
    const toAdd = [...wanted].filter((x) => !currentIds.has(x));
    if (toRemove.length) await db.delete(personServiceType).where(and(eq(personServiceType.personId, personId), inArray(personServiceType.serviceTypeId, toRemove)));
    if (toAdd.length) {
      await db.insert(personServiceType)
        .values(toAdd.map((serviceTypeId) => ({ personId, serviceTypeId })))
        .onConflictDoNothing();
    }
    await logActivity(req, 'updated', 'person', personId, 'roster');
    res.json({ data: { serviceTypeIds } });
  }),
);

// --- Safeguarding clearances (per person) ------------------------------------
peopleRouter.get(
  '/:id/clearances',
  requirePermission('view person'),
  asyncHandler(async (req, res) => {
    const personId = Number(req.params.id);
    const rows = await db.select().from(personClearances).where(eq(personClearances.personId, personId)).orderBy(desc(personClearances.createdAt));
    res.json({ data: rows });
  }),
);

const clearanceSchema = z.object({
  type: z.string().min(1).max(40),
  status: z.enum(['valid', 'pending', 'expired']).default('valid'),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// Replace the person's whole clearance set in one call (simple + race-free).
peopleRouter.put(
  '/:id/clearances',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const personId = Number(req.params.id);
    const { clearances } = z.object({ clearances: z.array(clearanceSchema).max(20).default([]) }).parse(req.body);
    const [person] = await db.select({ id: people.id }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).limit(1);
    if (!person) throw notFound();
    await db.delete(personClearances).where(eq(personClearances.personId, personId));
    if (clearances.length) {
      await db.insert(personClearances).values(clearances.map((c) => ({
        personId, type: c.type, status: c.status, issuedOn: c.issuedOn ?? null, expiresOn: c.expiresOn ?? null, notes: c.notes ?? null,
      })));
    }
    await logActivity(req, 'updated', 'person', personId, 'clearances');
    res.json({ data: { count: clearances.length } });
  }),
);

// Archive / un-archive. Archived people are kept but excluded from lists,
// pickers, ministry sends and messaging (we also flip isActive so every existing
// isActive filter honours it). Reversible — un-archive restores them.
peopleRouter.post(
  '/:id/archive',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db.update(people)
      .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt))).returning();
    if (!row) throw notFound();
    await logActivity(req, 'updated', 'person', id, 'archived');
    res.json({ data: row });
  }),
);
peopleRouter.post(
  '/:id/unarchive',
  requirePermission('update person'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db.update(people)
      .set({ archivedAt: null, isActive: true, updatedAt: new Date() })
      .where(and(eq(people.id, id), isNull(people.deletedAt))).returning();
    if (!row) throw notFound();
    await logActivity(req, 'updated', 'person', id, 'unarchived');
    res.json({ data: row });
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

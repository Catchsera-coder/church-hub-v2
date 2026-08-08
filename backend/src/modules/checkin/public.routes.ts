import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { attendanceEvents, attendanceRecords, checkinForms, households, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { badRequest, notFound } from '../../http/errors.js';
import { currentOrg } from '../settings/routes.js';
import { STANDARD_FIELD_KEYS } from './forms.routes.js';

/**
 * PUBLIC self-check-in (no auth). A person scans the big-screen/kiosk QR, which
 * opens /checkin/self/<token>; they find their name, tick who in their household
 * is present, and are recorded. People new to the church can add themselves and
 * their family.
 *
 * Guarded by an unguessable per-event token (not the sequential id) and only for
 * events flagged selfCheckinOpen; the router is IP rate-limited in app.ts.
 * Search returns names only — never contact details. Self-added people are
 * created as visitors, flagged `selfRegistered` and left `reviewedAt = null`
 * (pending staff review), and attendance is only ever recorded against real,
 * active people — so the endpoint can't be used to fabricate records.
 */
export const publicCheckinRouter = Router();

async function eventByToken(token: string) {
  const [ev] = await db
    .select()
    .from(attendanceEvents)
    .where(and(eq(attendanceEvents.publicToken, token), eq(attendanceEvents.selfCheckinOpen, true)))
    .limit(1);
  return ev;
}

const nameOf = (p: { givenName: Record<string, string>; familyName: Record<string, string> }) =>
  `${p.givenName?.en ?? p.givenName?.ar ?? ''} ${p.familyName?.en ?? p.familyName?.ar ?? ''}`.trim();

publicCheckinRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const ev = await eventByToken(req.params.token);
    if (!ev) throw notFound('This check-in link is not active.');
    // Church name gives the public page warm, correct branding (no logo blob here
    // — keep the public payload tiny).
    const org = await currentOrg();
    res.json({ data: { title: ev.title, startsAt: ev.startsAt, church: { name: org.name } } });
  }),
);

publicCheckinRouter.post(
  '/:token/search',
  asyncHandler(async (req, res) => {
    const ev = await eventByToken(req.params.token);
    if (!ev) throw notFound('This check-in link is not active.');
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.body);

    const like = `%${q}%`;
    // Match by name (either locale) OR phone number, so people can find themselves
    // however they think of their identity.
    const matched = await db
      .select({ id: people.id, givenName: people.givenName, familyName: people.familyName, householdId: people.householdId })
      .from(people)
      .where(and(
        isNull(people.deletedAt),
        eq(people.isActive, true),
        sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
          OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like}
          OR ${people.mobile} ILIKE ${like})`,
      ))
      .limit(8);

    // Pull household members so the whole family can be ticked at once.
    const householdIds = [...new Set(matched.map((m) => m.householdId).filter((x): x is number => x != null))];
    const members = householdIds.length
      ? await db
          .select({ id: people.id, givenName: people.givenName, familyName: people.familyName, householdId: people.householdId })
          .from(people)
          .where(and(isNull(people.deletedAt), eq(people.isActive, true), inArray(people.householdId, householdIds)))
      : [];

    const cards = matched.map((m) => {
      const family = m.householdId
        ? members.filter((x) => x.householdId === m.householdId)
        : [m];
      // ensure the matched person is in the list
      if (!family.some((x) => x.id === m.id)) family.unshift(m);
      return {
        id: m.id,
        name: nameOf(m),
        household: family.map((x) => ({ id: x.id, name: nameOf(x) })),
      };
    });

    res.json({ data: cards });
  }),
);

// Relationship label captured when someone adds a family member to themselves.
const RELATIONSHIP = ['self', 'husband', 'wife', 'spouse', 'partner', 'son', 'daughter', 'child', 'parent', 'sibling', 'other'] as const;
const emailField = z.union([z.string().email().max(190), z.literal('')]).optional();

const registerPerson = z.object({
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().max(80).optional().default(''),
  role: z.enum(RELATIONSHIP).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  email: emailField,
  mobile: z.string().trim().max(40).optional(),
  preferredLanguage: z.enum(['en', 'ar']).optional(),
  attending: z.boolean().default(true),
});

const recordSchema = z.object({
  // Existing people (from search) to check in for today.
  personIds: z.array(z.number().int().positive()).max(30).default([]),
  // New-to-the-church self-registration: the registrant plus any family.
  register: z
    .object({
      consent: z
        .object({
          email: z.boolean().default(false),
          sms: z.boolean().default(false),
          whatsapp: z.boolean().default(false),
        })
        .default({ email: false, sms: false, whatsapp: false }),
      people: z.array(registerPerson).min(1).max(16),
    })
    .optional(),
});

publicCheckinRouter.post(
  '/:token/record',
  asyncHandler(async (req, res) => {
    const ev = await eventByToken(req.params.token);
    if (!ev) throw notFound('This check-in link is not active.');
    const body = recordSchema.parse(req.body);
    const registrants = body.register?.people ?? [];
    if (!body.personIds.length && !registrants.length) throw badRequest('Select at least one person.');

    let checkedIn = 0;
    let registered = 0;

    // Existing people: only record attendance for ids that are genuinely active,
    // non-deleted people — never trust raw ids from the client.
    if (body.personIds.length) {
      const valid = await db
        .select({ id: people.id })
        .from(people)
        .where(and(inArray(people.id, body.personIds), eq(people.isActive, true), isNull(people.deletedAt)));
      for (const { id } of valid) {
        const [row] = await db
          .insert(attendanceRecords)
          .values({ attendanceEventId: ev.id, personId: id, recordedBy: null })
          .onConflictDoNothing()
          .returning();
        if (row) checkedIn++;
      }
    }

    // Self-registration: create one household for the group, add each person as a
    // visitor flagged for staff review, and check in whoever is present today.
    if (registrants.length) {
      const consent = body.register!.consent;
      const first = registrants[0]!;
      const familyName = (first.familyName || first.givenName).trim();
      const [household] = await db.insert(households).values({ name: { en: familyName } }).returning();

      for (const m of registrants) {
        const email = m.email && m.email.trim() ? m.email.trim().toLowerCase() : null;
        const mobile = m.mobile && m.mobile.trim() ? m.mobile.trim() : null;
        const [person] = await db
          .insert(people)
          .values({
            givenName: { en: m.givenName.trim() },
            familyName: { en: (m.familyName || familyName).trim() },
            householdId: household?.id ?? null,
            membershipStatus: 'visitor',
            email,
            mobile,
            dateOfBirth: m.dateOfBirth ?? null,
            preferredLanguage: m.preferredLanguage ?? 'en',
            householdRole: m.role ?? null,
            selfRegistered: true, // reviewedAt stays null → shows in the review queue
            // Positive opt-IN: a channel is only enabled when the person ticked it
            // AND we actually captured that contact method. Everything else stays
            // opted out (lawful default).
            emailOptOut: !(consent.email && email),
            smsOptOut: !(consent.sms && mobile),
            whatsappOptOut: !(consent.whatsapp && mobile),
          })
          .returning();
        if (!person) continue;
        registered++;
        if (m.attending) {
          await db
            .insert(attendanceRecords)
            .values({ attendanceEventId: ev.id, personId: person.id, recordedBy: null })
            .onConflictDoNothing();
          checkedIn++;
        }
      }
    }

    res.json({ data: { checkedIn, registered } });
  }),
);

// --- Admin-built standalone forms (Phase 3) ---------------------------------
// A shareable connect/registration form. Fields are configured by an admin; the
// public renders them dynamically. Standard keys map to people columns, the rest
// go to people.customFields. People are created as visitors flagged for review.
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

async function activeFormByToken(token: string) {
  const [form] = await db
    .select()
    .from(checkinForms)
    .where(and(eq(checkinForms.publicToken, token), eq(checkinForms.active, true)))
    .limit(1);
  return form;
}

publicCheckinRouter.get(
  '/form/:token',
  asyncHandler(async (req, res) => {
    const form = await activeFormByToken(req.params.token);
    if (!form) throw notFound('This form is not active.');
    const org = await currentOrg();
    res.json({
      data: {
        name: form.name, intro: form.intro, fields: form.fields,
        showFamily: form.showFamily, showConsent: form.showConsent,
        church: { name: org.name },
      },
    });
  }),
);

const formRegisterSchema = z.object({
  consent: z
    .object({ email: z.boolean().default(false), sms: z.boolean().default(false), whatsapp: z.boolean().default(false) })
    .default({ email: false, sms: false, whatsapp: false }),
  people: z.array(z.record(z.any())).min(1).max(16),
});

publicCheckinRouter.post(
  '/form/:token/register',
  asyncHandler(async (req, res) => {
    const form = await activeFormByToken(req.params.token);
    if (!form) throw notFound('This form is not active.');
    const body = formRegisterSchema.parse(req.body);
    const first = body.people[0]!;
    const firstGiven = str(first.givenName);
    if (!firstGiven) throw badRequest('Please enter your first name.');
    const familyName = str(first.familyName) || firstGiven;

    const [household] = await db.insert(households).values({ name: { en: familyName } }).returning();
    let registered = 0;
    for (const vals of body.people) {
      const given = str(vals.givenName);
      if (!given) continue;
      const email = str(vals.email);
      const mobile = str(vals.mobile);
      const custom: Record<string, string> = {};
      for (const [k, v] of Object.entries(vals)) {
        if (STANDARD_FIELD_KEYS.has(k) || k === 'attending' || k === 'role') continue;
        const s = str(v);
        if (s) custom[k] = s;
      }
      const [person] = await db
        .insert(people)
        .values({
          givenName: { en: given },
          familyName: { en: str(vals.familyName) || familyName },
          householdId: household?.id ?? null,
          membershipStatus: 'visitor',
          email: email ? email.toLowerCase() : null,
          mobile: mobile || null,
          dateOfBirth: str(vals.dateOfBirth) || null,
          preferredLanguage: vals.preferredLanguage === 'ar' ? 'ar' : 'en',
          householdRole: str(vals.householdRole) || str(vals.role) || null,
          selfRegistered: true,
          customFields: custom,
          emailOptOut: !(body.consent.email && email),
          smsOptOut: !(body.consent.sms && mobile),
          whatsappOptOut: !(body.consent.whatsapp && mobile),
        })
        .returning();
      if (person) registered++;
    }
    res.json({ data: { registered } });
  }),
);

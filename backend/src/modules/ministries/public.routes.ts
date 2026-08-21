import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { serviceTypes, people, personServiceType } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { badRequest, notFound } from '../../http/errors.js';
import { currentOrg } from '../settings/routes.js';

/**
 * PUBLIC ministry sign-up (no auth). Someone scans/opens a ministry's share link
 * (/join/<token>) and volunteers. Only works for ministries flagged
 * openToSignup. The person is created as a visitor, flagged `selfRegistered`
 * (reviewedAt = null → staff review queue), and added to the roster as a
 * volunteer. IP rate-limited in app.ts.
 */
export const publicMinistriesRouter = Router();

async function ministryByToken(token: string) {
  const [m] = await db
    .select()
    .from(serviceTypes)
    .where(and(eq(serviceTypes.publicToken, token), eq(serviceTypes.openToSignup, true), eq(serviceTypes.isActive, true)))
    .limit(1);
  return m;
}

publicMinistriesRouter.get('/:token', asyncHandler(async (req, res) => {
  const m = await ministryByToken(req.params.token);
  if (!m || m.deletedAt) throw notFound('This sign-up link is not active.');
  const org = await currentOrg();
  res.json({ data: { name: m.name, description: m.description, kind: m.kind, meetingDay: m.meetingDay, meetingTime: m.meetingTime, location: m.location, church: { name: org.name } } });
}));

const joinSchema = z.object({
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().max(80).optional().default(''),
  email: z.union([z.string().email().max(190), z.literal('')]).optional(),
  mobile: z.string().trim().max(40).optional(),
  preferredLanguage: z.enum(['en', 'ar']).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  consent: z.object({ email: z.boolean().default(false), sms: z.boolean().default(false), whatsapp: z.boolean().default(false) })
    .default({ email: false, sms: false, whatsapp: false }),
});

publicMinistriesRouter.post('/:token/join', asyncHandler(async (req, res) => {
  const m = await ministryByToken(req.params.token);
  if (!m || m.deletedAt) throw notFound('This sign-up link is not active.');
  const body = joinSchema.parse(req.body);
  if (!body.givenName.trim()) throw badRequest('Please enter your name.');
  const email = body.email && body.email.trim() ? body.email.trim().toLowerCase() : null;
  const mobile = body.mobile && body.mobile.trim() ? body.mobile.trim() : null;

  const [person] = await db.insert(people).values({
    givenName: { en: body.givenName.trim() },
    familyName: { en: body.familyName.trim() },
    membershipStatus: 'visitor',
    email, mobile,
    preferredLanguage: body.preferredLanguage ?? 'en',
    skills: body.skills ?? [],
    selfRegistered: true, // reviewedAt stays null → review queue
    emailOptOut: !(body.consent.email && email),
    smsOptOut: !(body.consent.sms && mobile),
    whatsappOptOut: !(body.consent.whatsapp && mobile),
  }).returning();
  if (!person) throw badRequest('Could not register.');

  await db.insert(personServiceType)
    .values({ serviceTypeId: m.id, personId: person.id, role: 'volunteer', status: 'active', servingSince: null })
    .onConflictDoNothing();

  res.json({ data: { ok: true } });
}));

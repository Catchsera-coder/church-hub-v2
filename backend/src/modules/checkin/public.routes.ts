import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { attendanceEvents, attendanceRecords, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { badRequest, notFound } from '../../http/errors.js';

/**
 * PUBLIC self-check-in (no auth). A person scans the big-screen/kiosk QR, which
 * opens /checkin/self/<token>; they find their name, tick who in their household
 * is present, and are recorded. New people are added to the directory as visitors.
 *
 * Guarded by an unguessable per-event token (not the sequential id) and only for
 * events flagged selfCheckinOpen. Returns names only — never contact details.
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
    res.json({ data: { title: ev.title, startsAt: ev.startsAt } });
  }),
);

publicCheckinRouter.post(
  '/:token/search',
  asyncHandler(async (req, res) => {
    const ev = await eventByToken(req.params.token);
    if (!ev) throw notFound('This check-in link is not active.');
    const { q } = z.object({ q: z.string().trim().min(1).max(80) }).parse(req.body);

    const like = `%${q}%`;
    const matched = await db
      .select({ id: people.id, givenName: people.givenName, familyName: people.familyName, householdId: people.householdId })
      .from(people)
      .where(and(
        isNull(people.deletedAt),
        eq(people.isActive, true),
        sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
          OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like})`,
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

const recordSchema = z.object({
  personIds: z.array(z.number().int().positive()).max(30).default([]),
  newMembers: z
    .array(z.object({ givenName: z.string().trim().min(1).max(80), familyName: z.string().trim().max(80).optional(), isChild: z.boolean().optional() }))
    .max(15)
    .default([]),
});

publicCheckinRouter.post(
  '/:token/record',
  asyncHandler(async (req, res) => {
    const ev = await eventByToken(req.params.token);
    if (!ev) throw notFound('This check-in link is not active.');
    const body = recordSchema.parse(req.body);
    if (!body.personIds.length && !body.newMembers.length) throw badRequest('Select at least one person.');

    let checkedIn = 0;

    for (const personId of body.personIds) {
      const [row] = await db.insert(attendanceRecords)
        .values({ attendanceEventId: ev.id, personId, recordedBy: null })
        .onConflictDoNothing()
        .returning();
      if (row) checkedIn++;
    }

    for (const nm of body.newMembers) {
      const [person] = await db.insert(people).values({
        givenName: { en: nm.givenName },
        familyName: { en: nm.familyName ?? '' },
        membershipStatus: 'visitor',
      }).returning();
      if (person) {
        await db.insert(attendanceRecords)
          .values({ attendanceEventId: ev.id, personId: person.id, recordedBy: null })
          .onConflictDoNothing();
        checkedIn++;
      }
    }

    res.json({ data: { checkedIn } });
  }),
);

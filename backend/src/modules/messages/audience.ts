import { z } from 'zod';
import { and, eq, inArray, isNull, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, personServiceType } from '../../db/schema.js';
import { peopleListQuery, peopleFilters } from '../people/filters.js';

// The audience spec stored on a campaign (and posted to /audience-count).
export const audienceZod = z.object({
  mode: z.enum(['all', 'people', 'ministries', 'segment']),
  personIds: z.array(z.number().int().positive()).max(10000).optional(),
  ministryIds: z.array(z.number().int().positive()).max(500).optional(),
  // Free-form filter map validated against the people filters below.
  segment: z.record(z.union([z.string(), z.number()])).optional(),
}).nullable();

export type Audience = z.infer<typeof audienceZod>;

/**
 * Resolve an audience to a concrete set of person ids, or `null` meaning
 * "everyone opted-in" (the caller then applies the channel opt-in filter). An
 * empty array means "no one" (an explicit empty selection). Dynamic modes
 * (ministries/segment) run their query at call time, so recurring sends always
 * reflect the current roster / segment.
 */
export async function resolveAudienceIds(audience: Audience | undefined): Promise<number[] | null> {
  if (!audience || audience.mode === 'all') return null;

  if (audience.mode === 'people') return audience.personIds ?? [];

  if (audience.mode === 'ministries') {
    const ids = audience.ministryIds ?? [];
    if (!ids.length) return [];
    const rows = await db
      .selectDistinct({ id: personServiceType.personId })
      .from(personServiceType)
      .where(and(inArray(personServiceType.serviceTypeId, ids), eq(personServiceType.status, 'active')));
    return rows.map((r) => r.id);
  }

  // segment: reuse the exact people-list filters so "who a segment reaches"
  // matches what the Members list shows for the same filters.
  const q = peopleListQuery.parse({ ...(audience.segment ?? {}), page: 1, limit: 1 });
  const rows = await db.select({ id: people.id }).from(people).where(and(...peopleFilters(q)));
  return rows.map((r) => r.id);
}

/**
 * Count how many people an audience would actually reach on a channel: active,
 * not deleted, opted-in on the channel, with a matching contact. Shared by the
 * composer's live "will reach N" indicator and any pre-send confirmation.
 */
export async function countReachable(channel: 'email' | 'sms' | 'whatsapp', audience: Audience | undefined): Promise<number> {
  const ids = await resolveAudienceIds(audience);
  if (ids && ids.length === 0) return 0;
  const contactCol = channel === 'email' ? people.email : people.mobile;
  const optOutCol = channel === 'email' ? people.emailOptOut : channel === 'whatsapp' ? people.whatsappOptOut : people.smsOptOut;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people)
    .where(and(
      eq(people.isActive, true), isNull(people.deletedAt),
      isNotNull(contactCol), ne(contactCol, ''), eq(optOutCol, false),
      ...(ids ? [inArray(people.id, ids)] : []),
    ));
  return count;
}

import { z } from 'zod';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { people, personServiceType, attendanceRecords } from '../../db/schema.js';

// Shared people list/export filters so the list and its export stay identical.
export const peopleListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  status: z.enum(['visitor', 'regular', 'member', 'inactive']).optional(),
  review: z.enum(['pending']).optional(),
  ageGroup: z.enum(['child', 'youth', 'adult']).optional(),
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  anniversaryMonth: z.coerce.number().int().min(1).max(12).optional(),
  ministryId: z.coerce.number().int().positive().optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  hasPhone: z.enum(['true', 'false']).optional(),
  optedIn: z.enum(['email', 'sms', 'whatsapp']).optional(),
  missingContact: z.enum(['true']).optional(),
  inactiveWeeks: z.coerce.number().int().min(1).max(104).optional(),
  // Archived visibility: default hides archived; 'only' shows just archived;
  // 'include' shows both.
  archived: z.enum(['only', 'include']).optional(),
});
export type PeopleQuery = z.infer<typeof peopleListQuery>;

/** Build the WHERE conditions for a people query (always excludes soft-deleted). */
export function peopleFilters(q: PeopleQuery): SQL[] {
  const filters: SQL[] = [isNull(people.deletedAt)];
  // Archived are excluded from normal views/pickers unless explicitly requested.
  if (q.archived === 'only') filters.push(sql`${people.archivedAt} IS NOT NULL`);
  else if (q.archived !== 'include') filters.push(isNull(people.archivedAt));
  if (q.status) filters.push(eq(people.membershipStatus, q.status));
  if (q.review === 'pending') { filters.push(eq(people.selfRegistered, true)); filters.push(isNull(people.reviewedAt)); }
  if (q.search) {
    const like = `%${q.search}%`;
    // Also let people be found by member number ("#42" or "42") and by their
    // middle/father's name (a common-surname disambiguator).
    const digits = q.search.replace(/^#/, '').trim();
    const idMatch = /^\d+$/.test(digits) ? sql` OR ${people.id} = ${Number(digits)}` : sql``;
    filters.push(sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
      OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like}
      OR ${people.middleName}->>'en' ILIKE ${like} OR ${people.middleName}->>'ar' ILIKE ${like}
      OR ${people.nickName}->>'en' ILIKE ${like} OR ${people.nickName}->>'ar' ILIKE ${like}
      OR ${people.email} ILIKE ${like} OR ${people.mobile} ILIKE ${like}${idMatch})`);
  }
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
  if (q.optedIn === 'email') filters.push(sql`${people.emailOptOut} = false AND ${people.email} IS NOT NULL AND ${people.email} <> ''`);
  if (q.optedIn === 'sms') filters.push(sql`${people.smsOptOut} = false AND ${people.mobile} IS NOT NULL AND ${people.mobile} <> ''`);
  if (q.optedIn === 'whatsapp') filters.push(sql`${people.whatsappOptOut} = false AND ${people.mobile} IS NOT NULL AND ${people.mobile} <> ''`);
  if (q.inactiveWeeks) filters.push(sql`NOT EXISTS (SELECT 1 FROM ${attendanceRecords} ar WHERE ar.person_id = ${people.id} AND ar.checked_in_at >= now() - (${q.inactiveWeeks} * interval '1 week'))`);
  return filters;
}

/** WHERE for people export (same filters, ignores paging). */
export function peopleWhere(q: PeopleQuery): SQL | undefined {
  return and(...peopleFilters(q));
}

import { z } from 'zod';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { people, personServiceType, attendanceRecords, attendanceEvents } from '../../db/schema.js';

// Accept a multi-value filter as a JSON array OR a comma-separated string.
const toArray = (v: unknown): unknown[] | undefined =>
  v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
const arrEnum = <T extends [string, ...string[]]>(vals: T) =>
  z.preprocess(toArray, z.array(z.enum(vals)).optional());
const arrNum = (min: number, max: number) =>
  z.preprocess(toArray, z.array(z.coerce.number().int().min(min).max(max)).optional());

// Shared people list/export filters so the list and its export stay identical.
export const peopleListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().trim().optional(),
  // Resolve a specific set of people by id (comma-separated), e.g. to show names
  // for pre-selected recipients. Bounded to keep the IN list sane.
  ids: z.string().trim().optional(),
  status: z.enum(['visitor', 'regular', 'member', 'inactive', 'conference_attendee']).optional(),
  review: z.enum(['pending']).optional(),
  ageGroup: z.enum(['child', 'youth', 'adult']).optional(),
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  anniversaryMonth: z.coerce.number().int().min(1).max(12).optional(),
  ministryId: z.coerce.number().int().positive().optional(),
  // Multi-value variants (segment targeting): any of these matches (OR within a
  // filter, AND across filters). Accept a JSON array OR a comma-separated string
  // so both the composer (JSON) and a query string work. The single-value fields
  // above are kept for the Members list, which filters one value at a time.
  statuses: arrEnum(['visitor', 'regular', 'member', 'inactive', 'conference_attendee']),
  ageGroups: arrEnum(['child', 'youth', 'adult']),
  birthdayMonths: arrNum(1, 12),
  ministryIds: arrNum(1, 1_000_000_000),
  hasEmail: z.enum(['true', 'false']).optional(),
  hasPhone: z.enum(['true', 'false']).optional(),
  optedIn: z.enum(['email', 'sms', 'whatsapp']).optional(),
  missingContact: z.enum(['true']).optional(),
  inactiveWeeks: z.coerce.number().int().min(1).max(104).optional(),
  // "Missed N of the last W weekly gatherings" — the follow-up group. Defaults:
  // missed>=2 of the last 4 weeks, members/regulars only. All tunable (admin).
  missed: z.enum(['1', 'true']).optional(),
  missedCount: z.coerce.number().int().min(1).max(12).optional(),
  missedWeeks: z.coerce.number().int().min(2).max(26).optional(),
  missedStatuses: z.string().optional(),
  // Archived visibility: default hides archived; 'only' shows just archived;
  // 'include' shows both.
  archived: z.enum(['only', 'include']).optional(),
  // Assimilation/follow-up pipeline stage (exact match; 'new_visitor' also pulls
  // in un-staged self-registered newcomers so the pipeline auto-seeds).
  followUpStage: z.string().max(30).optional(),
  // 'congregation' (your church people) vs 'contact' (external directory, e.g. the
  // conference list). The Members list defaults to congregation; a Contacts view
  // passes 'contact'. Omitted = both (e.g. messaging can reach everyone).
  category: z.enum(['congregation', 'contact']).optional(),
  // First-seen year — matches the real firstVisitOn year OR the year-only
  // provenance kept in customFields.firstSeenYear (imported lists without a date).
  firstSeenYear: z.coerce.number().int().min(1900).max(2100).optional(),
});
export type PeopleQuery = z.infer<typeof peopleListQuery>;

/** Build the WHERE conditions for a people query (always excludes soft-deleted). */
export function peopleFilters(q: PeopleQuery): SQL[] {
  const filters: SQL[] = [isNull(people.deletedAt)];
  // Archived are excluded from normal views/pickers unless explicitly requested.
  if (q.archived === 'only') filters.push(sql`${people.archivedAt} IS NOT NULL`);
  else if (q.archived !== 'include') filters.push(isNull(people.archivedAt));
  if (q.ids) {
    const idList = q.ids.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    filters.push(idList.length ? inArray(people.id, idList) : sql`false`);
  }
  if (q.status) filters.push(eq(people.membershipStatus, q.status));
  // Multi-value (segment) filters — OR within each, AND across them.
  if (q.statuses?.length) filters.push(inArray(people.membershipStatus, q.statuses as ('visitor' | 'regular' | 'member' | 'inactive' | 'conference_attendee')[]));
  if (q.ageGroups?.length) {
    const parts = q.ageGroups.map((g) => g === 'child'
      ? sql`(${people.dateOfBirth} IS NOT NULL AND extract(year from age(${people.dateOfBirth})) < 13)`
      : g === 'youth'
        ? sql`extract(year from age(${people.dateOfBirth})) BETWEEN 13 AND 17`
        : sql`extract(year from age(${people.dateOfBirth})) >= 18`);
    filters.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (q.birthdayMonths?.length) filters.push(sql`extract(month from ${people.dateOfBirth}) IN (${sql.join(q.birthdayMonths.map((m) => sql`${m}`), sql`, `)})`);
  if (q.ministryIds?.length) filters.push(sql`EXISTS (SELECT 1 FROM ${personServiceType} pst WHERE pst.person_id = ${people.id} AND pst.service_type_id IN (${sql.join(q.ministryIds.map((m) => sql`${m}`), sql`, `)}))`);
  if (q.category) filters.push(eq(people.category, q.category));
  if (q.firstSeenYear) filters.push(sql`(extract(year from ${people.firstVisitOn}) = ${q.firstSeenYear} OR ${people.customFields}->>'firstSeenYear' = ${String(q.firstSeenYear)})`);
  if (q.review === 'pending') { filters.push(eq(people.selfRegistered, true)); filters.push(isNull(people.reviewedAt)); }
  if (q.search) {
    // Full-name search that works in ANY order: split into words and require each
    // word to match SOME name field (given/family/middle/nick, en+ar). So "maged
    // ghobrial" (given + family) and "ghobrial maged" both match, while a single
    // word still matches on its own. Email/mobile/#id match the whole string.
    const raw = q.search.trim();
    const tokenMatch = (t: string) => {
      const like = `%${t}%`;
      return sql`(${people.givenName}->>'en' ILIKE ${like} OR ${people.familyName}->>'en' ILIKE ${like}
        OR ${people.givenName}->>'ar' ILIKE ${like} OR ${people.familyName}->>'ar' ILIKE ${like}
        OR ${people.middleName}->>'en' ILIKE ${like} OR ${people.middleName}->>'ar' ILIKE ${like}
        OR ${people.nickName}->>'en' ILIKE ${like} OR ${people.nickName}->>'ar' ILIKE ${like})`;
    };
    const tokens = raw.split(/\s+/).filter(Boolean).slice(0, 6);
    const nameAllTokens = tokens.length ? sql`(${sql.join(tokens.map(tokenMatch), sql` AND `)})` : sql`false`;
    const digits = raw.replace(/^#/, '').trim();
    const idMatch = /^\d+$/.test(digits) ? sql` OR ${people.id} = ${Number(digits)}` : sql``;
    const likeRaw = `%${raw}%`;
    filters.push(sql`(${nameAllTokens} OR ${people.email} ILIKE ${likeRaw} OR ${people.mobile} ILIKE ${likeRaw}${idMatch})`);
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
  if (q.missed) {
    const weeks = q.missedWeeks ?? 4;
    const count = q.missedCount ?? 2;
    const statuses = (q.missedStatuses ?? 'member,regular').split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) filters.push(inArray(people.membershipStatus, statuses as ('visitor' | 'regular' | 'member' | 'inactive' | 'conference_attendee')[]));
    // Weeks (in the window) that had a gathering MINUS weeks this person attended
    // one — i.e. how many weeks they missed. >= count → in the follow-up group.
    filters.push(sql`(
      (SELECT count(DISTINCT date_trunc('week', ae.starts_at)) FROM ${attendanceEvents} ae WHERE ae.starts_at >= now() - (${weeks} * interval '1 week') AND ae.starts_at <= now())
      - (SELECT count(DISTINCT date_trunc('week', ae2.starts_at)) FROM ${attendanceEvents} ae2 JOIN ${attendanceRecords} ar2 ON ar2.attendance_event_id = ae2.id AND ar2.person_id = ${people.id} WHERE ae2.starts_at >= now() - (${weeks} * interval '1 week') AND ae2.starts_at <= now())
    ) >= ${count}`);
  }
  if (q.followUpStage) {
    if (q.followUpStage === 'new_visitor') filters.push(sql`(${people.followUpStage} = 'new_visitor' OR (${people.followUpStage} IS NULL AND ${people.selfRegistered} = true AND ${people.reviewedAt} IS NULL))`);
    else filters.push(eq(people.followUpStage, q.followUpStage));
  }
  return filters;
}

/** WHERE for people export (same filters, ignores paging). */
export function peopleWhere(q: PeopleQuery): SQL | undefined {
  return and(...peopleFilters(q));
}

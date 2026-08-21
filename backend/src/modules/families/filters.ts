import { z } from 'zod';
import { and, isNull, sql, type SQL } from 'drizzle-orm';
import { households, people } from '../../db/schema.js';

export const familyListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  city: z.string().trim().optional(),
  hasChildren: z.enum(['true']).optional(),
  missingContact: z.enum(['true']).optional(),
  minSize: z.coerce.number().int().min(1).optional(),
});
export type FamilyQuery = z.infer<typeof familyListQuery>;

// Count EVERY non-deleted person in the household — matching the family detail
// roster and the Members list (neither filters on is_active).
//
// IMPORTANT: the correlation MUST be written as the literal `households.id`, NOT
// as `${households.id}`. Drizzle renders an interpolated column of the primary
// FROM table *unqualified* ("id"), and inside these subqueries (aliased `p`)
// Postgres then resolves bare "id" to the inner people.id — so the predicate
// silently became `p.household_id = p.id` and every count returned 0. The
// unaliased outer table is addressable by its real name, so `households.id`
// binds to the outer row correctly.
export const memberCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = households.id AND p.deleted_at IS NULL)`;
export const childCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = households.id AND p.deleted_at IS NULL AND p.date_of_birth IS NOT NULL AND extract(year from age(p.date_of_birth)) < 13)`;
// Family phone: the household's own home phone, else fall back to a member's mobile.
export const familyPhoneExpr = sql<string>`COALESCE(NULLIF(${households.homePhone}, ''), (SELECT p.mobile FROM ${people} p WHERE p.household_id = households.id AND p.mobile IS NOT NULL AND p.mobile <> '' AND p.deleted_at IS NULL ORDER BY p.id LIMIT 1))`;
// A short preview of member full names ("Samy Ibrahim, Hana Ibrahim") shown under
// the family name so two families with the same surname are tellable apart.
// Correlate via the literal households.id (Drizzle renders an interpolated column
// of the primary FROM table unqualified — see memberCountExpr note above).
export const membersPreviewExpr = sql<string>`(SELECT string_agg(nm, ', ') FROM (
  SELECT trim(coalesce(p.given_name->>'en','') || ' ' || coalesce(p.family_name->>'en','')) AS nm
  FROM ${people} p WHERE p.household_id = households.id AND p.deleted_at IS NULL ORDER BY p.id LIMIT 4
) t)`;

export function familyFilters(q: FamilyQuery): SQL[] {
  const filters: SQL[] = [isNull(households.deletedAt)];
  if (q.search) {
    const like = `%${q.search}%`;
    filters.push(sql`(${households.name}->>'en' ILIKE ${like} OR ${households.name}->>'ar' ILIKE ${like} OR ${households.city} ILIKE ${like})`);
  }
  if (q.city) filters.push(sql`${households.city} ILIKE ${`%${q.city}%`}`);
  if (q.hasChildren === 'true') filters.push(sql`${childCountExpr} > 0`);
  if (q.minSize) filters.push(sql`${memberCountExpr} >= ${q.minSize}`);
  if (q.missingContact === 'true') {
    filters.push(sql`(${households.homePhone} IS NULL OR ${households.homePhone} = '')
      AND NOT EXISTS (SELECT 1 FROM ${people} p WHERE p.household_id = households.id AND p.deleted_at IS NULL
        AND ((p.email IS NOT NULL AND p.email <> '') OR (p.mobile IS NOT NULL AND p.mobile <> '')))`);
  }
  return filters;
}

export function familyWhere(q: FamilyQuery): SQL | undefined {
  return and(...familyFilters(q));
}

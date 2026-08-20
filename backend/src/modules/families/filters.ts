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
// roster and the Members list (neither filters on is_active). Previously this
// required is_active = true, so self-registered visitors (who can be inactive)
// showed on the family page but counted as 0 on the list.
export const memberCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL)`;
export const childCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.date_of_birth IS NOT NULL AND extract(year from age(p.date_of_birth)) < 13)`;
// Family phone: the household's own home phone, else fall back to a member's mobile.
export const familyPhoneExpr = sql<string>`COALESCE(NULLIF(${households.homePhone}, ''), (SELECT p.mobile FROM ${people} p WHERE p.household_id = ${households.id} AND p.mobile IS NOT NULL AND p.mobile <> '' AND p.deleted_at IS NULL ORDER BY p.id LIMIT 1))`;

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
      AND NOT EXISTS (SELECT 1 FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL
        AND ((p.email IS NOT NULL AND p.email <> '') OR (p.mobile IS NOT NULL AND p.mobile <> '')))`);
  }
  return filters;
}

export function familyWhere(q: FamilyQuery): SQL | undefined {
  return and(...familyFilters(q));
}

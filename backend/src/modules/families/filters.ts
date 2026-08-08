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

export const memberCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.is_active = true)`;
export const childCountExpr = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.date_of_birth IS NOT NULL AND extract(year from age(p.date_of_birth)) < 13)`;

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

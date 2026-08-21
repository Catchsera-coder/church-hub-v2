import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { careItems, people, users } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

// Pastoral care — prayer requests, care items, visits, follow-up tasks.
export const careRouter = Router();
careRouter.use(authenticate);

const isAdmin = (req: { auth?: { roles: string[] } }) =>
  !!req.auth && (req.auth.roles.includes('Admin') || req.auth.roles.includes('Super Admin'));

const schema = z.object({
  personId: z.number().int().positive().nullable().optional(),
  type: z.enum(['prayer', 'care', 'visit', 'task']).default('prayer'),
  subject: z.string().trim().min(1).max(190),
  details: z.string().max(5000).nullable().optional(),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
  confidential: z.boolean().default(false),
  assignedToUserId: z.number().int().positive().nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const listQuery = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'active']).optional(), // 'active' = open+in_progress
  type: z.enum(['prayer', 'care', 'visit', 'task']).optional(),
  mine: z.enum(['true']).optional(),
  personId: z.coerce.number().int().positive().optional(),
});

// Rows the caller may not fully see (confidential + not admin/assignee/creator)
// get their details redacted, but still appear so nothing silently disappears.
function redact<T extends { confidential: boolean; assignedToUserId: number | null; createdByUserId: number | null; details: string | null }>(rows: T[], uid: number, admin: boolean): T[] {
  return rows.map((r) => {
    if (r.confidential && !admin && r.assignedToUserId !== uid && r.createdByUserId !== uid) {
      return { ...r, details: null, _redacted: true } as T;
    }
    return r;
  });
}

const selectCols = {
  id: careItems.id, personId: careItems.personId, type: careItems.type, subject: careItems.subject,
  details: careItems.details, status: careItems.status, confidential: careItems.confidential,
  assignedToUserId: careItems.assignedToUserId, dueOn: careItems.dueOn, createdByUserId: careItems.createdByUserId,
  closedAt: careItems.closedAt, createdAt: careItems.createdAt,
  personGiven: people.givenName, personFamily: people.familyName,
  assigneeName: sql<string | null>`(SELECT u.name FROM ${users} u WHERE u.id = ${careItems.assignedToUserId})`,
};

careRouter.get('/', requirePermission('view care'), asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const filters = [] as ReturnType<typeof eq>[];
  if (q.status === 'active') filters.push(ne(careItems.status, 'done'));
  else if (q.status) filters.push(eq(careItems.status, q.status));
  if (q.type) filters.push(eq(careItems.type, q.type));
  if (q.mine === 'true') filters.push(eq(careItems.assignedToUserId, req.auth!.sub));
  if (q.personId) filters.push(eq(careItems.personId, q.personId));
  const rows = await db.select(selectCols).from(careItems)
    .leftJoin(people, eq(people.id, careItems.personId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(sql`CASE ${careItems.status} WHEN 'done' THEN 1 ELSE 0 END`, desc(careItems.createdAt))
    .limit(500);
  res.json({ data: redact(rows as never, req.auth!.sub, isAdmin(req)) });
}));

careRouter.get('/counts', requirePermission('view care'), asyncHandler(async (req, res) => {
  const [row] = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status <> 'done')::int AS open,
      count(*) FILTER (WHERE status <> 'done' AND assigned_to_user_id = ${req.auth!.sub})::int AS mine,
      count(*) FILTER (WHERE status <> 'done' AND due_on IS NOT NULL AND due_on < current_date)::int AS overdue
    FROM care_items
  `).then((r) => r.rows);
  res.json({ data: { open: Number(row?.open ?? 0), mine: Number(row?.mine ?? 0), overdue: Number(row?.overdue ?? 0) } });
}));

careRouter.post('/', requirePermission('create care'), asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(careItems).values({
    ...b, dueOn: b.dueOn ?? null, createdByUserId: req.auth!.sub,
  }).returning();
  await logActivity(req, 'created', 'care', row!.id);
  res.status(201).json({ data: row });
}));

careRouter.put('/:id', requirePermission('update care'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = schema.partial().parse(req.body);
  const patch: Record<string, unknown> = { ...b, updatedAt: new Date() };
  if (b.dueOn !== undefined) patch.dueOn = b.dueOn ?? null;
  if (b.status !== undefined) patch.closedAt = b.status === 'done' ? new Date() : null;
  const [row] = await db.update(careItems).set(patch).where(eq(careItems.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'care', id);
  res.json({ data: row });
}));

careRouter.delete('/:id', requirePermission('delete care'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(careItems).where(eq(careItems.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'care', id);
  res.status(204).end();
}));

// Assignable users (staff) for the assignee picker.
careRouter.get('/assignees', requirePermission('view care'), asyncHandler(async (_req, res) => {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.isActive, true)).orderBy(users.name);
  res.json({ data: rows });
}));

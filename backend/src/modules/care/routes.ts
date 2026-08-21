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
  // Smart sharing (see schema.ts). confidential is kept in sync from shareScope.
  shareScope: z.enum(['private', 'assignees', 'church']).default('assignees'),
  shareDisclosure: z.enum(['full', 'name', 'anonymous']).default('full'),
  sharedUserIds: z.array(z.number().int().positive()).max(50).default([]),
  summary: z.string().trim().max(190).nullable().optional(),
  confidential: z.boolean().optional(), // legacy; derived from shareScope on write
  assignedToUserId: z.number().int().positive().nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const listQuery = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'active']).optional(), // 'active' = open+in_progress
  type: z.enum(['prayer', 'care', 'visit', 'task']).optional(),
  mine: z.enum(['true']).optional(),
  personId: z.coerce.number().int().positive().optional(),
});

// Apply the sharing model per viewer. Managers (Admin/Super Admin), the creator,
// the assignee and explicitly-shared servants always see the full item. Everyone
// else only sees a 'church'-scoped item, and only at its disclosure level; the
// real name/details are never sent to them ('anonymous' shows just the summary).
type VisRow = {
  confidential: boolean; assignedToUserId: number | null; createdByUserId: number | null;
  details: string | null; shareScope: string; shareDisclosure: string; sharedUserIds: unknown;
  summary: string | null; subject: string; personId: number | null;
  personGiven: unknown; personFamily: unknown;
};
function applyVisibility<T extends VisRow>(rows: T[], uid: number, admin: boolean): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const shared = Array.isArray(r.sharedUserIds) ? (r.sharedUserIds as number[]) : [];
    const privileged = admin || r.createdByUserId === uid || r.assignedToUserId === uid || shared.includes(uid);
    const scope = r.shareScope || (r.confidential ? 'private' : 'assignees');

    if (!privileged && scope !== 'church') continue; // not shared with this viewer → hide
    if (privileged) { out.push(r); continue; }        // full view

    // Non-privileged viewer of a church-wide item → honour the disclosure level.
    const disc = r.shareDisclosure || (r.confidential ? 'name' : 'full');
    if (disc === 'full') { out.push(r); continue; }
    if (disc === 'name') { out.push({ ...r, details: null, _disclosure: 'name' } as T); continue; }
    out.push({ ...r, details: null, personId: null, personGiven: null, personFamily: null,
      subject: r.summary || r.subject, _disclosure: 'anonymous' } as T);
  }
  return out;
}

const selectCols = {
  id: careItems.id, personId: careItems.personId, type: careItems.type, subject: careItems.subject,
  details: careItems.details, status: careItems.status, confidential: careItems.confidential,
  shareScope: careItems.shareScope, shareDisclosure: careItems.shareDisclosure,
  sharedUserIds: careItems.sharedUserIds, summary: careItems.summary,
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
  res.json({ data: applyVisibility(rows as never, req.auth!.sub, isAdmin(req)) });
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
    ...b, dueOn: b.dueOn ?? null,
    // Keep the legacy confidential flag in sync so older code/badges stay correct.
    confidential: b.shareScope === 'private',
    createdByUserId: req.auth!.sub,
  }).returning();
  await logActivity(req, 'created', 'care', row!.id);
  res.status(201).json({ data: row });
}));

careRouter.put('/:id', requirePermission('update care'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = schema.partial().parse(req.body);
  const patch: Record<string, unknown> = { ...b, updatedAt: new Date() };
  if (b.dueOn !== undefined) patch.dueOn = b.dueOn ?? null;
  if (b.shareScope !== undefined) patch.confidential = b.shareScope === 'private';
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

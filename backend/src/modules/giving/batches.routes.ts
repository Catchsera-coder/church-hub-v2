import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { batches, contributions } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const batchesRouter = Router();
batchesRouter.use(authenticate);

const schema = z.object({
  name: z.string().min(1).max(190),
  receivedOn: z.string(),
  expectedTotalCents: z.number().int().nullable().optional(), // pre-counted total in minor units
  notes: z.string().nullable().optional(),
});

// Entered total = sum of contributions in the batch; variance = entered - expected.
async function withTotals(id: number) {
  const [row] = await db.select().from(batches).where(eq(batches.id, id)).limit(1);
  if (!row) return null;
  const [{ entered }] = await db
    .select({ entered: sql<number>`coalesce(sum(${contributions.amountCents}),0)::bigint` })
    .from(contributions)
    .where(eq(contributions.batchId, id));
  const enteredCents = Number(entered);
  const variance = row.expectedTotalCents === null ? null : enteredCents - row.expectedTotalCents;
  return { ...row, enteredCents, varianceCents: variance, reconciles: variance === null || variance === 0 };
}

batchesRouter.get('/', requirePermission('view batch'), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(batches).orderBy(desc(batches.receivedOn), desc(batches.id));
  const data = await Promise.all(rows.map((r) => withTotals(r.id)));
  res.json({ data });
}));

batchesRouter.post('/', requirePermission('create batch'), asyncHandler(async (req, res) => {
  const [row] = await db.insert(batches).values(schema.parse(req.body)).returning();
  await logActivity(req, 'created', 'batch', row!.id);
  res.status(201).json({ data: await withTotals(row!.id) });
}));

// Closing a session freezes it. Closing out of balance is allowed but must carry
// a reason (a deliberate act, not a stray click).
batchesRouter.post('/:id/close', requirePermission('update batch'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const reason = z.object({ reason: z.string().optional() }).parse(req.body ?? {}).reason;
  const totals = await withTotals(id);
  if (!totals) throw notFound();
  if (totals.closedAt) throw badRequest('Session already closed');
  if (!totals.reconciles && !reason) throw badRequest('This session is out of balance — a reason is required to close it');
  const notes = !totals.reconciles && reason ? `${totals.notes ?? ''}\n${reason}`.trim() : totals.notes;
  await db.update(batches).set({ closedAt: new Date(), closedByUserId: req.auth!.sub, notes, updatedAt: new Date() }).where(eq(batches.id, id));
  await logActivity(req, 'updated', 'batch', id, 'closed');
  res.json({ data: await withTotals(id) });
}));

import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { contributions, people, funds, batches } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const contributionsRouter = Router();
contributionsRouter.use(authenticate);

// Amounts arrive as major units (e.g. 25.00) and are stored as integer minor
// units (2500). Never store floats.
const createSchema = z.object({
  personId: z.number().int().positive().nullable().optional(),
  householdId: z.number().int().positive().nullable().optional(),
  fundId: z.number().int().positive(),
  batchId: z.number().int().positive().nullable().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  receivedOn: z.string(),
  method: z.enum(['cash', 'cheque', 'card', 'bank', 'other']).default('cash'),
  reference: z.string().max(190).nullable().optional(),
  isAnonymous: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  fundId: z.coerce.number().int().positive().optional(),
  personId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

contributionsRouter.get(
  '/',
  requirePermission('view contribution'),
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const filters = [isNull(contributions.deletedAt)];
    if (q.fundId) filters.push(eq(contributions.fundId, q.fundId));
    if (q.personId) filters.push(eq(contributions.personId, q.personId));
    if (q.batchId) filters.push(eq(contributions.batchId, q.batchId));
    if (q.from) filters.push(gte(contributions.receivedOn, q.from));
    if (q.to) filters.push(lte(contributions.receivedOn, q.to));
    const where = and(...filters);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(contributions).where(where);
    const [{ net }] = await db
      .select({ net: sql<number>`coalesce(sum(${contributions.amountCents}),0)::bigint` })
      .from(contributions)
      .where(where);
    const rows = await db
      .select({
        id: contributions.id,
        amountCents: contributions.amountCents,
        currency: contributions.currency,
        receivedOn: contributions.receivedOn,
        method: contributions.method,
        reference: contributions.reference,
        isAnonymous: contributions.isAnonymous,
        reversesId: contributions.reversesId,
        fundCode: funds.code,
        fundName: funds.name,
        givenName: people.givenName,
        familyName: people.familyName,
      })
      .from(contributions)
      .leftJoin(funds, eq(funds.id, contributions.fundId))
      .leftJoin(people, eq(people.id, contributions.personId))
      .where(where)
      .orderBy(desc(contributions.receivedOn), desc(contributions.id))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);

    res.json({ data: rows, meta: { page: q.page, limit: q.limit, total: count, pages: Math.ceil(count / q.limit), netTotalCents: Number(net) } });
  }),
);

contributionsRouter.post(
  '/',
  requirePermission('create contribution'),
  asyncHandler(async (req, res) => {
    const b = createSchema.parse(req.body);
    // A closed counting session is frozen: never let a new gift land in it (or in
    // a batch that doesn't exist), which would silently shift its entered total.
    if (b.batchId != null) {
      const [batch] = await db.select({ closedAt: batches.closedAt }).from(batches).where(eq(batches.id, b.batchId)).limit(1);
      if (!batch) throw badRequest('That counting session does not exist');
      if (batch.closedAt) throw badRequest('That counting session is closed');
    }
    const [row] = await db
      .insert(contributions)
      .values({
        personId: b.personId ?? null,
        householdId: b.householdId ?? null,
        fundId: b.fundId,
        batchId: b.batchId ?? null,
        amountCents: Math.round(b.amount * 100),
        currency: b.currency.toUpperCase(),
        receivedOn: b.receivedOn,
        method: b.method,
        reference: b.reference ?? null,
        isAnonymous: b.isAnonymous,
        notes: b.notes ?? null,
        recordedBy: req.auth!.sub,
      })
      .returning();
    await logActivity(req, 'created', 'contribution', row!.id);
    res.status(201).json({ data: row });
  }),
);

/**
 * AD-5 correction: a reversal is a NEW negative row carrying the same donor,
 * fund, currency and DATE as the original (so it lands in the same tax year),
 * with reverses_id pointing at it. The original is never edited or deleted.
 * Deliberately not attached to the original batch — that batch may be closed.
 */
contributionsRouter.post(
  '/:id/reverse',
  requirePermission('create contribution'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reason = z.object({ reason: z.string().min(1) }).parse(req.body).reason;

    const [orig] = await db.select().from(contributions).where(and(eq(contributions.id, id), isNull(contributions.deletedAt))).limit(1);
    if (!orig) throw notFound();
    if (orig.reversesId !== null) throw badRequest('Cannot reverse a reversal');

    const [already] = await db.select({ id: contributions.id }).from(contributions).where(eq(contributions.reversesId, id)).limit(1);
    if (already) throw conflict('This contribution has already been reversed');

    const [reversal] = await db
      .insert(contributions)
      .values({
        personId: orig.personId,
        householdId: orig.householdId,
        fundId: orig.fundId,
        batchId: null,
        amountCents: -orig.amountCents,
        currency: orig.currency,
        receivedOn: orig.receivedOn,
        method: orig.method,
        reference: orig.reference,
        isAnonymous: orig.isAnonymous,
        reversesId: orig.id,
        recordedBy: req.auth!.sub,
        notes: reason,
      })
      .returning();
    await logActivity(req, 'created', 'contribution', reversal!.id, `reversal of #${id}`);
    res.status(201).json({ data: reversal });
  }),
);

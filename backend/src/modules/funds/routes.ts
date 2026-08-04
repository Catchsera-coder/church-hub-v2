import { Router } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { funds } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { conflict, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

export const fundsRouter = Router();
fundsRouter.use(authenticate);

const schema = z.object({
  name: z.record(z.string()).default({}),
  code: z.string().min(1).max(32),
  isTaxDeductible: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

fundsRouter.get('/', requirePermission('view fund'), asyncHandler(async (_req, res) => {
  const rows = await db.select().from(funds).orderBy(asc(funds.sortOrder), asc(funds.code));
  res.json({ data: rows });
}));

fundsRouter.post('/', requirePermission('create fund'), asyncHandler(async (req, res) => {
  const body = schema.parse(req.body);
  body.code = body.code.toUpperCase();
  const [dup] = await db.select({ id: funds.id }).from(funds).where(eq(funds.code, body.code)).limit(1);
  if (dup) throw conflict('A fund with this code already exists');
  const [row] = await db.insert(funds).values(body).returning();
  await logActivity(req, 'created', 'fund', row!.id);
  res.status(201).json({ data: row });
}));

fundsRouter.put('/:id', requirePermission('update fund'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = schema.partial().parse(req.body);
  if (body.code) body.code = body.code.toUpperCase();
  const [row] = await db.update(funds).set({ ...body, updatedAt: new Date() }).where(eq(funds.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'fund', id);
  res.json({ data: row });
}));

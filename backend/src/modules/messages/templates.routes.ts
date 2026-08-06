import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageTemplates } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

/**
 * Branded message templates (#20b). Reusable subject/header/body/footer copy a
 * church picks from when composing a campaign. Reuses the `message` permission
 * resource (templates are part of messaging) so no new permissions are needed.
 * Mirrors the CRUD shape of families/routes.ts.
 */
export const messageTemplatesRouter = Router();
messageTemplatesRouter.use(authenticate);

const schema = z.object({
  name: z.string().min(1).max(190),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
  subject: z.record(z.string()).default({}),
  header: z.record(z.string()).default({}),
  body: z.record(z.string()).default({}),
  footer: z.record(z.string()).default({}),
  isActive: z.boolean().default(true),
});

messageTemplatesRouter.get('/', requirePermission('view message'), asyncHandler(async (_req, res) => {
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(isNull(messageTemplates.deletedAt))
    .orderBy(desc(messageTemplates.updatedAt));
  res.json({ data: rows });
}));

messageTemplatesRouter.get('/:id', requirePermission('view message'), asyncHandler(async (req, res) => {
  const [row] = await db.select().from(messageTemplates)
    .where(and(eq(messageTemplates.id, Number(req.params.id)), isNull(messageTemplates.deletedAt))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

messageTemplatesRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(messageTemplates).values({ ...b, createdByUserId: req.auth!.sub }).returning();
  await logActivity(req, 'created', 'message_template', row!.id);
  res.status(201).json({ data: row });
}));

messageTemplatesRouter.put('/:id', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(messageTemplates)
    .set({ ...schema.partial().parse(req.body), updatedAt: new Date() })
    .where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'message_template', id);
  res.json({ data: row });
}));

messageTemplatesRouter.delete('/:id', requirePermission('delete message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(messageTemplates).set({ deletedAt: new Date() })
    .where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt))).returning();
  if (!row) throw notFound();
  await logActivity(req, 'deleted', 'message_template', id);
  res.status(204).end();
}));

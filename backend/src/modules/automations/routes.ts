import { Router } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { automations } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { recipientsFor, runAutomation, resolveMessaging, type Channel } from './service.js';
import { currentOrg } from '../settings/routes.js';

const TYPES = ['birthday', 'join_anniversary', 'first_visit_anniversary', 'welcome', 'absence_followup'] as const;

// Enabling/disabling automations is an Admin (or Super Admin) responsibility.
export const automationsRouter = Router();
automationsRouter.use(authenticate);
automationsRouter.use(requireRole('Admin'));

async function ensureDefaults(): Promise<void> {
  const existing = await db.select({ type: automations.type }).from(automations);
  const have = new Set(existing.map((e) => e.type));
  const missing = TYPES.filter((t) => !have.has(t));
  if (missing.length) {
    await db.insert(automations)
      .values(missing.map((t) => ({ type: t, config: (t === 'absence_followup' ? { absenceWeeks: 4 } : {}) as Record<string, number | string> })))
      .onConflictDoNothing();
  }
}

automationsRouter.get('/', asyncHandler(async (_req, res) => {
  await ensureDefaults();
  const rows = await db.select().from(automations).orderBy(asc(automations.id));
  res.json({ data: rows });
}));

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['auto', 'manual']).optional(),
  channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
  templateId: z.number().int().positive().nullable().optional(),
  config: z.record(z.union([z.number(), z.string()])).optional(),
});

automationsRouter.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = updateSchema.parse(req.body);
  const [row] = await db.update(automations).set({ ...b, updatedAt: new Date() }).where(eq(automations.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'automation', id);
  res.json({ data: row });
}));

// How many people match this automation's trigger right now.
automationsRouter.get('/:id/preview', asyncHandler(async (req, res) => {
  const [a] = await db.select().from(automations).where(eq(automations.id, Number(req.params.id))).limit(1);
  if (!a) throw notFound();
  const recips = await recipientsFor(a.type, a.config);
  res.json({ data: { count: recips.length } });
}));

// Send now — manual trigger (or to test an auto one).
automationsRouter.post('/:id/run', asyncHandler(async (req, res) => {
  const [a] = await db.select().from(automations).where(eq(automations.id, Number(req.params.id))).limit(1);
  if (!a) throw notFound();
  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging);
  const result = await runAutomation({ type: a.type, channel: a.channel as Channel, templateId: a.templateId, config: a.config }, org, messaging);
  await db.update(automations).set({ lastRunOn: new Date().toISOString().slice(0, 10), updatedAt: new Date() }).where(eq(automations.id, a.id));
  await logActivity(req, 'updated', 'automation', a.id, `run: ${result.sent}/${result.total}`);
  res.json({ data: result });
}));

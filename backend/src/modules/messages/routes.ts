import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendMessage } from './delivery.js';

export const messagesRouter = Router();
messagesRouter.use(authenticate);

const schema = z.object({
  name: z.string().min(1).max(190),
  channel: z.enum(['email', 'sms']).default('email'),
  subject: z.record(z.string()).default({}),
  body: z.record(z.string()).default({}),
  scheduledFor: z.string().nullable().optional(),
});

messagesRouter.get('/', requirePermission('view message'), asyncHandler(async (_req, res) => {
  const rows = await db
    .select({
      id: messageCampaigns.id, name: messageCampaigns.name, channel: messageCampaigns.channel,
      status: messageCampaigns.status, scheduledFor: messageCampaigns.scheduledFor, sentAt: messageCampaigns.sentAt,
      recipients: sql<number>`(select count(*)::int from ${messageRecipients} r where r.message_campaign_id = ${messageCampaigns.id})`,
    })
    .from(messageCampaigns)
    .orderBy(desc(messageCampaigns.createdAt));
  res.json({ data: rows });
}));

messagesRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(messageCampaigns).values({
    name: b.name, channel: b.channel, subject: b.subject, body: b.body,
    scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : null,
    createdByUserId: req.auth!.sub,
  }).returning();
  await logActivity(req, 'created', 'message', row!.id);
  res.status(201).json({ data: row });
}));

messagesRouter.put('/:id', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!existing) throw notFound();
  if (existing.status === 'sending' || existing.status === 'sent') throw badRequest('A sent campaign cannot be edited');
  const b = schema.partial().parse(req.body);
  const [row] = await db.update(messageCampaigns).set({
    ...b, scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : existing.scheduledFor, updatedAt: new Date(),
  }).where(eq(messageCampaigns.id, id)).returning();
  res.json({ data: row });
}));

/**
 * Send now. Recipients = active people who have the channel's contact field.
 * Sent SYNCHRONOUSLY through the delivery adapter — deliberately NOT a database
 * queue with no worker (the v1 bug where campaigns silently never sent). For
 * large lists this should move to a real worker; see delivery.ts.
 */
messagesRouter.post('/:id/send', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!c) throw notFound();
  if (c.status === 'sent' || c.status === 'sending') throw badRequest('Already sent');

  const contactCol = c.channel === 'email' ? people.email : people.mobile;
  const audience = await db
    .select({ id: people.id, contact: contactCol, lang: people.preferredLanguage })
    .from(people)
    .where(and(eq(people.isActive, true), isNull(people.deletedAt), isNotNull(contactCol), ne(contactCol, '')));

  await db.update(messageCampaigns).set({ status: 'sending', updatedAt: new Date() }).where(eq(messageCampaigns.id, id));

  let sent = 0;
  for (const p of audience) {
    const [rec] = await db.insert(messageRecipients).values({ messageCampaignId: id, personId: p.id }).onConflictDoNothing().returning();
    if (!rec) continue;
    const ok = await sendMessage(c.channel, p.contact as string, c.subject[p.lang] ?? c.subject.en ?? '', c.body[p.lang] ?? c.body.en ?? '');
    await db.update(messageRecipients).set({ status: ok ? 'sent' : 'failed' }).where(eq(messageRecipients.id, rec.id));
    if (ok) sent++;
  }

  await db.update(messageCampaigns).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(messageCampaigns.id, id));
  await logActivity(req, 'updated', 'message', id, `sent to ${sent}/${audience.length}`);
  res.json({ data: { sent, total: audience.length } });
}));

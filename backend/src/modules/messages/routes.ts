import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendCampaignNow } from './send.js';
import { resolveAi, draftMessages, type AiChannel } from './ai.js';
import { currentOrg } from '../settings/routes.js';

export const messagesRouter = Router();
messagesRouter.use(authenticate);

// Cost-bearing endpoints: AI calls Anthropic (credits) and send fans out to the
// whole congregation (SMS/email spend). Cap them so one account can't burn spend.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const sendLimiter = rateLimit({ windowMs: 60_000, max: 5 });

const schema = z.object({
  name: z.string().min(1).max(190),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
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

/**
 * AI compose: draft copy for one or more channels from a short brief. Returns
 * drafts only — nothing is saved or sent. Gated on an Anthropic key (Settings or
 * env); replies 400 "AI not configured" when absent so the UI can hide/disable
 * the feature rather than fail mid-flow.
 */
const aiSchema = z.object({
  brief: z.string().min(3).max(2000),
  channels: z.array(z.enum(['email', 'sms', 'whatsapp'])).min(1),
  locales: z.array(z.string().max(8)).min(1).max(4).default(['en']),
  tone: z.string().max(120).optional(),
});

messagesRouter.post('/ai-draft', aiLimiter, requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = aiSchema.parse(req.body);
  const org = await currentOrg();
  const ai = resolveAi(org.messaging);
  if (!ai) throw badRequest('AI is not configured. Add an Anthropic API key in Settings → Messaging.');
  const churchName = org.name?.en ?? org.name?.ar ?? undefined;
  try {
    const draft = await draftMessages(ai, {
      brief: b.brief,
      channels: b.channels as AiChannel[],
      locales: b.locales,
      tone: b.tone,
      churchName,
    });
    res.json({ data: draft });
  } catch (err) {
    // Log the provider detail server-side; return a generic message to the client.
    console.error('[ai-draft] failed:', err instanceof Error ? err.message : err);
    throw badRequest('AI drafting failed. Please try again.');
  }
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

// Send now. Personalises per recipient (merge fields) and brands email as HTML;
// see messages/send.ts (shared with the scheduler for scheduled campaigns).
messagesRouter.post('/:id/send', sendLimiter, requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select({ status: messageCampaigns.status }).from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!c) throw notFound();
  if (c.status === 'sent' || c.status === 'sending') throw badRequest('Already sent');
  const result = await sendCampaignNow(id);
  await logActivity(req, 'updated', 'message', id, `sent: ${result.sent}/${result.total}`);
  res.json({ data: result });
}));

// Schedule (or reschedule) a campaign to send later — the worker picks it up.
messagesRouter.post('/:id/schedule', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { scheduledFor } = z.object({ scheduledFor: z.string() }).parse(req.body);
  const when = new Date(scheduledFor);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) throw badRequest('Pick a future date and time.');
  const [existing] = await db.select({ status: messageCampaigns.status }).from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!existing) throw notFound();
  if (existing.status === 'sent' || existing.status === 'sending') throw badRequest('This campaign has already been sent.');
  const [row] = await db.update(messageCampaigns).set({ status: 'scheduled', scheduledFor: when, updatedAt: new Date() }).where(eq(messageCampaigns.id, id)).returning();
  await logActivity(req, 'updated', 'message', id, 'scheduled');
  res.json({ data: row });
}));

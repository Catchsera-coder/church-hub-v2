import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { resolveMessaging, sendMessage } from './delivery.js';
import { resolveAi, draftMessages, type AiChannel } from './ai.js';
import { currentOrg } from '../settings/routes.js';
import { config } from '../../config.js';

export const messagesRouter = Router();
messagesRouter.use(authenticate);

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

messagesRouter.post('/ai-draft', requirePermission('create message'), asyncHandler(async (req, res) => {
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
    throw badRequest(err instanceof Error ? err.message : 'AI draft failed.');
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

  // Email uses the email address; SMS and WhatsApp both use the mobile number.
  const contactCol = c.channel === 'email' ? people.email : people.mobile;
  // Lawful sending: never message people who opted out of this channel.
  const optOutCol = c.channel === 'email' ? people.emailOptOut
    : c.channel === 'whatsapp' ? people.whatsappOptOut
    : people.smsOptOut;
  const audience = await db
    .select({ id: people.id, contact: contactCol, lang: people.preferredLanguage, unsubToken: people.unsubToken })
    .from(people)
    .where(and(eq(people.isActive, true), isNull(people.deletedAt), isNotNull(contactCol), ne(contactCol, ''), eq(optOutCol, false)));

  await db.update(messageCampaigns).set({ status: 'sending', updatedAt: new Date() }).where(eq(messageCampaigns.id, id));

  // Resolve this church's messaging config once (Settings-tab values over env).
  const messaging = resolveMessaging((await currentOrg()).messaging);
  const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');

  let sent = 0;
  for (const p of audience) {
    const [rec] = await db.insert(messageRecipients).values({ messageCampaignId: id, personId: p.id }).onConflictDoNothing().returning();
    if (!rec) continue;
    let body = c.body[p.lang] ?? c.body.en ?? '';
    // Email footer with a one-click unsubscribe link (CAN-SPAM / lawful sending).
    if (c.channel === 'email' && appUrl) {
      body += `\n\n—\nTo stop receiving these emails, unsubscribe: ${appUrl}/unsubscribe/${p.unsubToken}`;
    }
    const ok = await sendMessage(messaging, c.channel, p.contact as string, c.subject[p.lang] ?? c.subject.en ?? '', body);
    await db.update(messageRecipients).set({ status: ok ? 'sent' : 'failed' }).where(eq(messageRecipients.id, rec.id));
    if (ok) sent++;
  }

  // Honest campaign status: if there were recipients but not one delivery was
  // accepted (e.g. the channel's provider isn't configured), the campaign failed
  // — don't paint it green. Otherwise it sent (fully or partially).
  const finalStatus = audience.length > 0 && sent === 0 ? 'failed' : 'sent';
  await db.update(messageCampaigns).set({ status: finalStatus, sentAt: new Date(), updatedAt: new Date() }).where(eq(messageCampaigns.id, id));
  await logActivity(req, 'updated', 'message', id, `${finalStatus}: ${sent}/${audience.length}`);
  res.json({ data: { sent, total: audience.length } });
}));

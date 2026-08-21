import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients, people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendCampaignNow } from './send.js';
import { resolveAi, draftMessages, type AiChannel } from './ai.js';
import { resolveMessaging, sendMessage } from './delivery.js';
import { buildContext, renderText, brandedEmailHtml, localeName } from './render.js';
import { scheduleZod } from '../scheduling/schedule.js';
import { audienceZod, countReachable } from './audience.js';
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
  mediaUrl: z.string().nullable().optional(),
  // Optional email call-to-action button: localized label + a link.
  ctaLabel: z.record(z.string()).nullable().optional(),
  ctaUrl: z.string().max(2000).nullable().optional(),
  // Recipient targeting: all opted-in, an explicit person list, ministries/groups
  // rosters, or a dynamic segment (people filters). See messages/audience.ts.
  audience: audienceZod.optional(),
  schedule: scheduleZod.nullable().optional(),
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

// Live "will reach N" for the composer: how many people the chosen audience
// actually reaches on the channel (active, opted-in, contactable).
messagesRouter.post('/audience-count', requirePermission('view message'), asyncHandler(async (req, res) => {
  const b = z.object({ channel: z.enum(['email', 'sms', 'whatsapp']), audience: audienceZod.optional() }).parse(req.body);
  const count = await countReachable(b.channel, b.audience ?? null);
  res.json({ data: { count } });
}));

messagesRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(messageCampaigns).values({
    name: b.name, channel: b.channel, subject: b.subject, body: b.body,
    scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : null,
    mediaUrl: b.mediaUrl ?? null,
    ctaLabel: b.ctaLabel ?? null,
    ctaUrl: b.ctaUrl ?? null,
    audience: b.audience ?? null,
    schedule: b.schedule ?? null,
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

// Schedule a campaign to send later — either one-time (`scheduledFor`) or
// recurring (`schedule`). The worker picks it up. Recurring campaigns re-send on
// each due occurrence; one-time send once.
messagesRouter.post('/:id/schedule', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ scheduledFor: z.string().optional(), schedule: scheduleZod.optional() }).parse(req.body);
  const [existing] = await db.select({ status: messageCampaigns.status }).from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!existing) throw notFound();
  if (existing.status === 'sending') throw badRequest('This campaign is currently sending.');

  if (b.schedule && b.schedule.mode === 'recurring') {
    const [row] = await db.update(messageCampaigns)
      .set({ status: 'scheduled', schedule: b.schedule, scheduledFor: null, lastRunOn: null, updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id)).returning();
    await logActivity(req, 'updated', 'message', id, 'scheduled (recurring)');
    return res.json({ data: row });
  }

  if (!b.scheduledFor) throw badRequest('Pick a date and time, or a recurring schedule.');
  const when = new Date(b.scheduledFor);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) throw badRequest('Pick a future date and time.');
  const [row] = await db.update(messageCampaigns)
    .set({ status: 'scheduled', scheduledFor: when, schedule: null, updatedAt: new Date() })
    .where(eq(messageCampaigns.id, id)).returning();
  await logActivity(req, 'updated', 'message', id, 'scheduled');
  res.json({ data: row });
}));

// --- Preview: render a message exactly as a recipient will see it ------------
// Email → branded HTML; SMS/WhatsApp → the plain text. Uses a sample person so
// merge fields ({{firstName}} etc.) show real-looking values. No send, no save.
const previewSchema = z.object({
  channel: z.enum(['email', 'sms', 'whatsapp']),
  subject: z.record(z.string()).default({}),
  body: z.record(z.string()).default({}),
  ctaLabel: z.record(z.string()).nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  lang: z.string().max(8).optional(),
});
messagesRouter.post('/preview', requirePermission('view message'), asyncHandler(async (req, res) => {
  const b = previewSchema.parse(req.body);
  const org = await currentOrg();
  const lang = b.lang || org.locale || 'en';
  const sample = { givenName: { [lang]: 'Sarah' }, familyName: { [lang]: 'Hana' }, email: 'sarah@example.com', mobile: '+1 555 0100', preferredLanguage: lang };
  const ctx = buildContext(sample, org, new Date(), lang);
  const subject = renderText(b.subject[lang] ?? b.subject.en ?? '', ctx);
  const bodyText = renderText(b.body[lang] ?? b.body.en ?? '', ctx);
  const cta = b.ctaLabel && b.ctaUrl ? { label: renderText(localeName(b.ctaLabel, lang), ctx), url: b.ctaUrl } : null;
  if (b.channel === 'email') {
    const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
    const html = brandedEmailHtml(bodyText, org, { lang, signature, cta, unsubscribeUrl: '#', preheader: subject });
    res.json({ data: { channel: 'email', subject, html, text: bodyText } });
  } else {
    const text = [bodyText, cta ? `${cta.label}: ${cta.url}` : ''].filter(Boolean).join('\n\n');
    res.json({ data: { channel: b.channel, text } });
  }
}));

// --- Quick send: one message to a single member or an ad-hoc phone/email ------
// Sends immediately (no campaign row). For scheduled/recurring or many
// recipients, use a campaign with an audience + schedule.
const quickSendSchema = z.object({
  channel: z.enum(['email', 'sms', 'whatsapp']),
  toPersonId: z.number().int().positive().nullable().optional(),
  toContact: z.string().max(190).nullable().optional(),
  subject: z.record(z.string()).default({}),
  body: z.record(z.string()).default({}),
  ctaLabel: z.record(z.string()).nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  mediaUrl: z.string().nullable().optional(),
});
messagesRouter.post('/quick-send', sendLimiter, requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = quickSendSchema.parse(req.body);
  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
  let person: typeof people.$inferSelect | null = null;
  let contact = (b.toContact ?? '').trim();
  if (b.toPersonId) {
    [person] = await db.select().from(people).where(and(eq(people.id, b.toPersonId), isNull(people.deletedAt))).limit(1);
    if (!person) throw notFound();
    contact = (b.channel === 'email' ? person.email : person.mobile) ?? '';
  }
  if (!contact) throw badRequest('No recipient for this channel — pick a person with the right contact, or type a number/email.');
  const lang = person?.preferredLanguage || org.locale || 'en';
  const ctx = buildContext(person ?? { givenName: {}, familyName: {} }, org, new Date(), lang);
  const subject = renderText(b.subject[lang] ?? b.subject.en ?? '', ctx);
  const bodyText = renderText(b.body[lang] ?? b.body.en ?? '', ctx);
  const cta = b.ctaLabel && b.ctaUrl ? { label: renderText(localeName(b.ctaLabel, lang), ctx), url: b.ctaUrl } : null;
  const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
  const html = b.channel === 'email' ? brandedEmailHtml(bodyText, org, { lang, signature, cta }) : undefined;
  const plain = [bodyText, cta ? `${cta.label}: ${cta.url}` : '', signature].filter(Boolean).join('\n\n');
  const ok = await sendMessage(messaging, b.channel, contact, subject, plain, html, b.mediaUrl ?? undefined);
  res.json({ data: { ok, to: contact } });
}));

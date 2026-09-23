import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { messageAttachments, messageCampaigns, messageRecipients, people, smsMessages, users } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';
import { sendCampaignNow } from './send.js';
import { resolveAi, draftMessages, type AiChannel } from './ai.js';
import { resolveMessaging, sendMessage } from './delivery.js';
import { buildContext, renderText, brandedEmailHtml, localeName } from './render.js';
import { loadAttachmentsByTokens, prepareDelivery, dataUriAttachment, previewImagesHtml, type OutAttachment } from './attach.js';
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
  // Tokens of files uploaded via /messages/attachments, linked to this campaign.
  attachmentTokens: z.array(z.string().max(80)).max(50).optional(),
  // Where image attachments appear in email: in the body, attached, or both.
  imagePlacement: z.enum(['body', 'attach', 'both']).default('body'),
});

/** Attach previously-uploaded (unlinked) files to a campaign. */
async function linkAttachments(campaignId: number, tokens?: string[]): Promise<void> {
  if (!tokens?.length) return;
  await db.update(messageAttachments).set({ campaignId })
    .where(and(inArray(messageAttachments.token, tokens), isNull(messageAttachments.campaignId)));
}

// Sent-log list. Every past/scheduled/draft message with who composed it, who
// sent it, when, the channel/status, and per-recipient tallies (total/sent/
// failed). Filterable by channel, status, sender, free-text name, and a date
// range over "when it happened" (sent → scheduled → created).
const listQuery = z.object({
  channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'failed']).optional(),
  sender: z.coerce.number().int().positive().optional(),
  q: z.string().max(190).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});
messagesRouter.get('/', requirePermission('view message'), asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const creator = alias(users, 'creator');
  const sender = alias(users, 'sender');
  const recCount = (status?: 'sent' | 'failed') =>
    sql<number>`(select count(*)::int from ${messageRecipients} r where r.message_campaign_id = ${messageCampaigns.id}${status ? sql` and r.status = ${status}` : sql``})`;
  const whenExpr = sql`coalesce(${messageCampaigns.sentAt}, ${messageCampaigns.scheduledFor}, ${messageCampaigns.createdAt})`;

  const filters = [] as any[];
  if (q.channel) filters.push(eq(messageCampaigns.channel, q.channel));
  if (q.status) filters.push(eq(messageCampaigns.status, q.status));
  if (q.sender) filters.push(eq(messageCampaigns.createdByUserId, q.sender));
  if (q.q?.trim()) filters.push(ilike(messageCampaigns.name, `%${q.q.trim()}%`));
  if (q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) filters.push(gte(whenExpr, d)); }
  if (q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); filters.push(lte(whenExpr, d)); } }

  const rows = await db
    .select({
      id: messageCampaigns.id, name: messageCampaigns.name, channel: messageCampaigns.channel,
      status: messageCampaigns.status, scheduledFor: messageCampaigns.scheduledFor, sentAt: messageCampaigns.sentAt,
      createdAt: messageCampaigns.createdAt,
      createdByUserId: messageCampaigns.createdByUserId, createdByName: creator.name,
      sentByUserId: messageCampaigns.sentByUserId, sentByName: sender.name,
      recipients: recCount(), sent: recCount('sent'), failed: recCount('failed'),
    })
    .from(messageCampaigns)
    .leftJoin(creator, eq(creator.id, messageCampaigns.createdByUserId))
    .leftJoin(sender, eq(sender.id, messageCampaigns.sentByUserId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(whenExpr));
  res.json({ data: rows });
}));

// The distinct people who have composed messages — powers the "Sender" filter.
messagesRouter.get('/senders', requirePermission('view message'), asyncHandler(async (_req, res) => {
  const rows = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(messageCampaigns)
    .innerJoin(users, eq(users.id, messageCampaigns.createdByUserId))
    .orderBy(users.name);
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

// --- Two-way SMS inbox: inbound texts captured by the provider webhook -------
messagesRouter.get('/inbox', requirePermission('view message'), asyncHandler(async (req, res) => {
  const onlyOpen = req.query.handled === 'false';
  const rows = await db
    .select({
      id: smsMessages.id, personId: smsMessages.personId, fromNumber: smsMessages.fromNumber,
      body: smsMessages.body, receivedAt: smsMessages.receivedAt, handled: smsMessages.handled,
      givenName: people.givenName, familyName: people.familyName,
    })
    .from(smsMessages)
    .leftJoin(people, eq(people.id, smsMessages.personId))
    .where(and(eq(smsMessages.direction, 'inbound'), onlyOpen ? eq(smsMessages.handled, false) : undefined))
    .orderBy(desc(smsMessages.receivedAt))
    .limit(200);
  res.json({ data: rows });
}));

messagesRouter.get('/inbox/count', requirePermission('view message'), asyncHandler(async (_req, res) => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(smsMessages).where(and(eq(smsMessages.direction, 'inbound'), eq(smsMessages.handled, false)));
  res.json({ data: { count } });
}));

messagesRouter.put('/inbox/:id', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { handled } = z.object({ handled: z.boolean() }).parse(req.body);
  const [row] = await db.update(smsMessages).set({ handled }).where(eq(smsMessages.id, id)).returning();
  if (!row) throw notFound();
  res.json({ data: row });
}));

// Live "will reach N" for the composer: how many people the chosen audience
// actually reaches on the channel (active, opted-in, contactable).
messagesRouter.post('/audience-count', requirePermission('view message'), asyncHandler(async (req, res) => {
  const b = z.object({ channel: z.enum(['email', 'sms', 'whatsapp']), audience: audienceZod.optional() }).parse(req.body);
  const count = await countReachable(b.channel, b.audience ?? null);
  res.json({ data: { count } });
}));

// --- Single message: full detail for review (content + who/when/status) -------
// Rendered exactly as recipients saw it: branded HTML for email, plain text for
// SMS/WhatsApp, per available language.
messagesRouter.get('/:id(\\d+)', requirePermission('view message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const creator = alias(users, 'creator');
  const sender = alias(users, 'sender');
  const [row] = await db
    .select({
      id: messageCampaigns.id, name: messageCampaigns.name, channel: messageCampaigns.channel,
      subject: messageCampaigns.subject, body: messageCampaigns.body, status: messageCampaigns.status,
      scheduledFor: messageCampaigns.scheduledFor, sentAt: messageCampaigns.sentAt, createdAt: messageCampaigns.createdAt,
      mediaUrl: messageCampaigns.mediaUrl, ctaLabel: messageCampaigns.ctaLabel, ctaUrl: messageCampaigns.ctaUrl,
      imagePlacement: messageCampaigns.imagePlacement,
      audience: messageCampaigns.audience, schedule: messageCampaigns.schedule,
      createdByUserId: messageCampaigns.createdByUserId, createdByName: creator.name,
      sentByUserId: messageCampaigns.sentByUserId, sentByName: sender.name,
    })
    .from(messageCampaigns)
    .leftJoin(creator, eq(creator.id, messageCampaigns.createdByUserId))
    .leftJoin(sender, eq(sender.id, messageCampaigns.sentByUserId))
    .where(eq(messageCampaigns.id, id)).limit(1);
  if (!row) throw notFound();

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${messageRecipients.status} = 'sent')::int`,
      failed: sql<number>`count(*) filter (where ${messageRecipients.status} = 'failed')::int`,
      pending: sql<number>`count(*) filter (where ${messageRecipients.status} = 'pending')::int`,
    })
    .from(messageRecipients).where(eq(messageRecipients.messageCampaignId, id));

  // Render the stored content the way a recipient received it, per language.
  const org = await currentOrg();
  const langs = Array.from(new Set([...Object.keys(row.body ?? {}), org.locale || 'en'].filter(Boolean)));
  const sample = { givenName: {}, familyName: {}, preferredLanguage: langs[0] };
  const rendered = langs.map((lang) => {
    const ctx = buildContext(sample, org, new Date(), lang);
    const subject = renderText(row.subject?.[lang] ?? row.subject?.en ?? '', ctx);
    const bodyText = renderText(row.body?.[lang] ?? row.body?.en ?? '', ctx);
    const cta = row.ctaLabel && row.ctaUrl ? { label: renderText(localeName(row.ctaLabel, lang), ctx), url: row.ctaUrl } : null;
    if (row.channel === 'email') {
      const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
      const html = brandedEmailHtml(bodyText, org, { lang, signature, cta, unsubscribeUrl: '#', preheader: subject });
      return { lang, subject, html, text: bodyText };
    }
    return { lang, text: [bodyText, cta ? `${cta.label}: ${cta.url}` : ''].filter(Boolean).join('\n\n') };
  });

  const attachments = await db
    .select({ token: messageAttachments.token, filename: messageAttachments.filename, contentType: messageAttachments.contentType, sizeBytes: messageAttachments.sizeBytes })
    .from(messageAttachments).where(eq(messageAttachments.campaignId, id));

  res.json({ data: { ...row, counts, rendered, attachments } });
}));

// Per-recipient log: who received it, on what contact, delivery status, and when.
messagesRouter.get('/:id(\\d+)/recipients', requirePermission('view message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select({
      id: messageRecipients.id, personId: messageRecipients.personId, status: messageRecipients.status,
      sentAt: messageRecipients.sentAt, toContact: messageRecipients.toContact,
      resolvedName: messageRecipients.resolvedName, error: messageRecipients.error,
      givenName: people.givenName, familyName: people.familyName,
      email: people.email, mobile: people.mobile,
    })
    .from(messageRecipients)
    .leftJoin(people, eq(people.id, messageRecipients.personId))
    .where(eq(messageRecipients.messageCampaignId, id))
    .orderBy(desc(messageRecipients.sentAt), messageRecipients.id);
  res.json({ data: rows });
}));

messagesRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = schema.parse(req.body);
  const [row] = await db.insert(messageCampaigns).values({
    name: b.name, channel: b.channel, subject: b.subject, body: b.body,
    scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : null,
    mediaUrl: b.mediaUrl ?? null,
    ctaLabel: b.ctaLabel ?? null,
    ctaUrl: b.ctaUrl ?? null,
    imagePlacement: b.imagePlacement,
    audience: b.audience ?? null,
    schedule: b.schedule ?? null,
    createdByUserId: req.auth!.sub,
  }).returning();
  await linkAttachments(row!.id, b.attachmentTokens);
  await logActivity(req, 'created', 'message', row!.id);
  res.status(201).json({ data: row });
}));

messagesRouter.put('/:id', requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!existing) throw notFound();
  if (existing.status === 'sending' || existing.status === 'sent') throw badRequest('A sent campaign cannot be edited');
  const { attachmentTokens, ...b } = schema.partial().parse(req.body);
  const [row] = await db.update(messageCampaigns).set({
    ...b, scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : existing.scheduledFor, updatedAt: new Date(),
  }).where(eq(messageCampaigns.id, id)).returning();
  await linkAttachments(id, attachmentTokens);
  res.json({ data: row });
}));

// Send now. Personalises per recipient (merge fields) and brands email as HTML;
// see messages/send.ts (shared with the scheduler for scheduled campaigns).
messagesRouter.post('/:id/send', sendLimiter, requirePermission('update message'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [c] = await db.select({ status: messageCampaigns.status }).from(messageCampaigns).where(eq(messageCampaigns.id, id)).limit(1);
  if (!c) throw notFound();
  if (c.status === 'sent' || c.status === 'sending') throw badRequest('Already sent');
  const result = await sendCampaignNow(id, req.auth!.sub);
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
  attachmentTokens: z.array(z.string().max(80)).max(50).optional(),
  imagePlacement: z.enum(['body', 'attach', 'both']).default('body'),
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
    // Preview uses public-URL images (they load in the same-origin iframe); real
    // sends embed them as cid: (see send.ts). Logo/header use their URLs here too.
    const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
    const attachmentsHtml = await previewImagesHtml(b.attachmentTokens ?? [], appUrl, b.imagePlacement);
    const html = brandedEmailHtml(bodyText, org, { lang, signature, cta, unsubscribeUrl: '#', preheader: subject, attachmentsHtml });
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
  attachmentTokens: z.array(z.string().max(80)).max(50).optional(),
  imagePlacement: z.enum(['body', 'attach', 'both']).default('body'),
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
  // Attachments: inline for email (within cap) or secure links appended to the body.
  const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  const prepared = await prepareDelivery(await loadAttachmentsByTokens(b.attachmentTokens ?? []), b.channel, appUrl, b.imagePlacement);
  const logoAtt = b.channel === 'email' ? dataUriAttachment(org.logoPath, 'logo', 'logo') : null;
  const headerAtt = b.channel === 'email' ? dataUriAttachment(org.emailSettings?.headerImage, 'header', 'headerimg') : null;
  const brandAtts: OutAttachment[] = [logoAtt, headerAtt].filter((x): x is OutAttachment => Boolean(x));
  const bodyWithLinks = prepared.linkLines.length ? `${bodyText}\n\n${prepared.linkLines.join('\n')}` : bodyText;
  const html = b.channel === 'email' ? brandedEmailHtml(bodyWithLinks, org, { lang, signature, cta, attachmentsHtml: prepared.imagesHtml, logoCid: logoAtt ? 'logo' : undefined, headerImageCid: headerAtt ? 'headerimg' : undefined }) : undefined;
  const plain = [bodyWithLinks, cta ? `${cta.label}: ${cta.url}` : '', signature].filter(Boolean).join('\n\n');
  const ok = await sendMessage(messaging, b.channel, contact, subject, plain, html, b.mediaUrl ?? undefined, [...brandAtts, ...prepared.inline]);

  // Log the direct send so it appears in the sent-log alongside campaigns: a
  // lightweight campaign row (marked as a direct send) + one recipient row.
  const recipientName = person
    ? [localeName(person.givenName, lang), localeName(person.familyName, lang)].filter(Boolean).join(' ').trim() || contact
    : contact;
  const name = `${b.channel === 'email' ? '✉️' : '💬'} ${recipientName}`.slice(0, 190);
  const now = new Date();
  try {
    const [camp] = await db.insert(messageCampaigns).values({
      name, channel: b.channel, subject: b.subject, body: b.body,
      status: ok ? 'sent' : 'failed', sentAt: now,
      ctaLabel: b.ctaLabel ?? null, ctaUrl: b.ctaUrl ?? null, mediaUrl: b.mediaUrl ?? null,
      audience: person ? { mode: 'people', personIds: [person.id] } : null,
      createdByUserId: req.auth!.sub, sentByUserId: req.auth!.sub,
    }).returning();
    if (camp && person) {
      await db.insert(messageRecipients).values({
        messageCampaignId: camp.id, personId: person.id,
        status: ok ? 'sent' : 'failed', sentAt: now, toContact: contact, resolvedName: recipientName,
      });
    }
    if (camp) await linkAttachments(camp.id, b.attachmentTokens);
    await logActivity(req, 'updated', 'message', camp?.id ?? null, `direct send: ${ok ? 'sent' : 'failed'} → ${contact}`);
  } catch (err) {
    // Never fail the user's send just because logging hit a snag.
    console.error('[quick-send] log failed:', err instanceof Error ? err.message : err);
  }
  res.json({ data: { ok, to: contact } });
}));

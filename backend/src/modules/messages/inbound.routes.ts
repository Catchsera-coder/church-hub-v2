import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, smsMessages } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';

/**
 * PUBLIC inbound-message handling for both providers.
 *
 *  - Twilio: point the number's "A MESSAGE COMES IN" webhook (form-encoded) at
 *    https://<host>/api/public/sms/inbound
 *  - Azure Communication Services: create an Event Grid subscription (topic =
 *    your ACS resource, event type "SMS Received") delivering (Event Grid schema,
 *    JSON) to https://<host>/api/public/acs/events
 *
 * Either way we log the message, link it to a person by their mobile, and honour
 * opt-out keywords automatically:
 *  STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT -> smsOptOut = true
 *  START / YES / UNSTOP                                -> smsOptOut = false
 * (For ACS toll-free numbers US carriers ALSO enforce STOP at the network level,
 *  so compliance holds even before this handler runs — this keeps our own opt-out
 *  flags + SMS inbox in sync.)
 */

const STOP = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START = new Set(['start', 'yes', 'unstop']);
const digits = (s: string) => (s || '').replace(/[^0-9]/g, '');

// Shared: match the sender to a person (mobile last-10), log the inbound message,
// and apply opt-out/opt-in keywords. Provider-agnostic.
async function handleInbound(opts: { from: string; to: string; body: string; provider: string; sid?: string }) {
  const { from, to, body, provider, sid } = opts;
  const d = digits(from);

  let personId: number | null = null;
  if (d.length >= 7) {
    const last10 = d.slice(-10);
    const [p] = await db.select({ id: people.id })
      .from(people)
      .where(and(isNull(people.deletedAt), sql`right(regexp_replace(coalesce(${people.mobile},''), '[^0-9]', '', 'g'), 10) = ${last10}`))
      .limit(1);
    if (p) personId = p.id;
  }

  await db.insert(smsMessages).values({
    direction: 'inbound', personId, fromNumber: from || null, toNumber: to || null,
    body: body || null, provider, providerSid: sid || null, status: 'received',
  });

  const kw = (body || '').trim().toLowerCase();
  if (personId && STOP.has(kw)) {
    await db.update(people).set({ smsOptOut: true, whatsappOptOut: true, updatedAt: new Date() }).where(eq(people.id, personId));
  } else if (personId && START.has(kw)) {
    await db.update(people).set({ smsOptOut: false, updatedAt: new Date() }).where(eq(people.id, personId));
  }
}

// --- Twilio inbound (form-encoded) ------------------------------------------
export const publicInboundRouter = Router();
publicInboundRouter.post('/sms/inbound', asyncHandler(async (req, res) => {
  await handleInbound({
    from: String(req.body?.From ?? ''),
    to: String(req.body?.To ?? ''),
    body: String(req.body?.Body ?? ''),
    provider: 'twilio',
    sid: String(req.body?.MessageSid ?? req.body?.SmsSid ?? ''),
  });
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}));

// --- Azure Communication Services inbound (Event Grid, JSON) -----------------
// Handles the one-time Event Grid subscription-validation handshake and each
// SMSReceived event. Events arrive as an array (Event Grid schema).
export const publicAcsRouter = Router();
publicAcsRouter.post('/events', asyncHandler(async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  // 1) Subscription-validation handshake — echo the code so Event Grid activates.
  for (const ev of events) {
    if (ev?.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
      return res.json({ validationResponse: ev?.data?.validationCode });
    }
  }

  // 2) Inbound SMS (and, when enabled, WhatsApp) — same person-match + opt-out.
  for (const ev of events) {
    const d = ev?.data ?? {};
    if (ev?.eventType === 'Microsoft.Communication.SMSReceived') {
      await handleInbound({ from: String(d.from ?? ''), to: String(d.to ?? ''), body: String(d.message ?? ''), provider: 'azure', sid: String(d.messageId ?? '') });
    } else if (ev?.eventType === 'Microsoft.Communication.AdvancedMessageReceived') {
      // Inbound WhatsApp via ACS Advanced Messaging (content is a text payload).
      const text = typeof d.content === 'string' ? d.content : (d.content?.text ?? d.message ?? '');
      await handleInbound({ from: String(d.from ?? ''), to: String(d.to ?? ''), body: String(text ?? ''), provider: 'azure-whatsapp', sid: String(d.messageId ?? d.id ?? '') });
    }
  }
  res.status(200).end();
}));

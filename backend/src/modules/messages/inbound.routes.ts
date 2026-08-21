import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, smsMessages } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';

/**
 * PUBLIC inbound SMS webhook (Twilio). Point the number's "A MESSAGE COMES IN"
 * webhook at https://<host>/api/public/sms/inbound. We log the message, link it
 * to a person by their mobile, and honour opt-out keywords automatically:
 *  STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT -> smsOptOut = true
 *  START / YES / UNSTOP                                -> smsOptOut = false
 * Always replies 200 with empty TwiML so the carrier doesn't retry/err.
 * (Signature validation is a recommended hardening step; rate-limited in app.ts.)
 */
export const publicInboundRouter = Router();

const STOP = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START = new Set(['start', 'yes', 'unstop']);
const digits = (s: string) => (s || '').replace(/[^0-9]/g, '');

publicInboundRouter.post('/sms/inbound', asyncHandler(async (req, res) => {
  const from = String(req.body?.From ?? '');
  const to = String(req.body?.To ?? '');
  const body = String(req.body?.Body ?? '');
  const sid = String(req.body?.MessageSid ?? req.body?.SmsSid ?? '');
  const d = digits(from);

  // Match a person by the last 10 digits of their mobile.
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
    body: body || null, provider: 'twilio', providerSid: sid || null, status: 'received',
  });

  // Auto opt-out / opt-in on standard keywords (applies to the matched person).
  const kw = body.trim().toLowerCase();
  if (personId && STOP.has(kw)) {
    await db.update(people).set({ smsOptOut: true, whatsappOptOut: true, updatedAt: new Date() }).where(eq(people.id, personId));
  } else if (personId && START.has(kw)) {
    await db.update(people).set({ smsOptOut: false, updatedAt: new Date() }).where(eq(people.id, personId));
  }

  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}));

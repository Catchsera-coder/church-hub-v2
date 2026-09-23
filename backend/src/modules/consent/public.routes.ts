import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { notFound } from '../../http/errors.js';

/**
 * PUBLIC unsubscribe / consent management (no auth) via a per-person token from
 * message footers. Lets a recipient stop email/SMS/WhatsApp — required by law.
 */
export const publicConsentRouter = Router();

const nameOf = (p: { givenName: Record<string, string>; familyName: Record<string, string> }) =>
  `${p.givenName?.en ?? p.givenName?.ar ?? ''} ${p.familyName?.en ?? p.familyName?.ar ?? ''}`.trim();

publicConsentRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const [p] = await db.select().from(people).where(eq(people.unsubToken, req.params.token)).limit(1);
    if (!p) throw notFound('Link not found.');
    res.json({ data: { name: nameOf(p), emailOptOut: p.emailOptOut, smsOptOut: p.smsOptOut, whatsappOptOut: p.whatsappOptOut } });
  }),
);

// RFC 8058 one-click unsubscribe: the `List-Unsubscribe` header points here and
// the mail client POSTs `List-Unsubscribe=One-Click` with no user interaction.
// Any POST to this path opts the person out of EMAIL (headers are email-only).
// Gmail/Yahoo bulk-sender requirement — improves deliverability + inbox trust.
publicConsentRouter.post(
  '/:token/one-click',
  asyncHandler(async (req, res) => {
    const [p] = await db.select({ id: people.id }).from(people).where(eq(people.unsubToken, req.params.token)).limit(1);
    if (!p) throw notFound('Link not found.');
    await db.update(people).set({ emailOptOut: true, updatedAt: new Date() }).where(eq(people.id, p.id));
    res.status(200).send('Unsubscribed.');
  }),
);

publicConsentRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const body = z.object({
      emailOptOut: z.boolean().optional(),
      smsOptOut: z.boolean().optional(),
      whatsappOptOut: z.boolean().optional(),
    }).parse(req.body);
    const [p] = await db.select({ id: people.id }).from(people).where(eq(people.unsubToken, req.params.token)).limit(1);
    if (!p) throw notFound('Link not found.');
    // Opt-OUT only: a leaked footer link must never be able to silently re-subscribe
    // someone. Only `true` values are applied; re-subscribing is done by staff.
    const set: Record<string, unknown> = {};
    if (body.emailOptOut === true) set.emailOptOut = true;
    if (body.smsOptOut === true) set.smsOptOut = true;
    if (body.whatsappOptOut === true) set.whatsappOptOut = true;
    if (Object.keys(set).length) await db.update(people).set({ ...set, updatedAt: new Date() }).where(eq(people.id, p.id));
    res.json({ data: { ok: true } });
  }),
);

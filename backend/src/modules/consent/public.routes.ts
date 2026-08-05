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
    await db.update(people).set({ ...body, updatedAt: new Date() }).where(eq(people.id, p.id));
    res.json({ data: { ok: true } });
  }),
);

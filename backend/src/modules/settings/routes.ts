import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { organisations } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { config } from '../../config.js';

export const settingsRouter = Router();

/** The single organisation row (white-label). Public read so the SPA can brand
 *  the login screen; only Admins can write. */
export async function currentOrg() {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, 1)).limit(1);
  if (org) return org;
  const [created] = await db
    .insert(organisations)
    .values({ id: 1, currency: config.DEFAULT_CURRENCY, timezone: config.DEFAULT_TIMEZONE, locale: config.DEFAULT_LOCALE })
    .returning();
  return created!;
}

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const org = await currentOrg();
    res.json({ data: org });
  }),
);

const updateSchema = z.object({
  name: z.record(z.string()).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(8).optional(),
  logoPath: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
});

settingsRouter.put(
  '/',
  authenticate,
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    if (body.currency) body.currency = body.currency.toUpperCase();
    await currentOrg(); // ensure row exists
    const [org] = await db.update(organisations).set({ ...body, updatedAt: new Date() }).where(eq(organisations.id, 1)).returning();
    res.json({ data: org });
  }),
);

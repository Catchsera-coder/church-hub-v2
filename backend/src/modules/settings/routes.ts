import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { organisations, type MessagingSettings } from '../../db/schema.js';
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
    // PUBLIC endpoint — never expose the messaging block (it holds secrets).
    const { messaging: _messaging, ...safe } = org;
    res.json({ data: safe });
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
  arabicEnabled: z.boolean().optional(),
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
    const { messaging: _messaging, ...safe } = org!;
    res.json({ data: safe });
  }),
);

// --- Messaging settings (Admin only) ----------------------------------------
// Secrets are never returned — reads report only whether each is set, plus the
// non-secret identifiers (from-addresses, provider choice, Twilio SID).
settingsRouter.get(
  '/messaging',
  authenticate,
  requireRole('Admin'),
  asyncHandler(async (_req, res) => {
    const m = (await currentOrg()).messaging ?? {};
    res.json({
      data: {
        emailProvider: m.emailProvider ?? '',
        mailFrom: m.mailFrom ?? '',
        sendgridApiKeySet: Boolean(m.sendgridApiKey),
        acsMailFrom: m.acsMailFrom ?? '',
        smsProvider: m.smsProvider ?? '',
        smsFrom: m.smsFrom ?? '',
        twilioAccountSid: m.twilioAccountSid ?? '',
        twilioAuthTokenSet: Boolean(m.twilioAuthToken),
        acsSmsFrom: m.acsSmsFrom ?? '',
        acsConnectionStringSet: Boolean(m.acsConnectionString),
        // Surfaced so admins know an env default is active even if unset here.
        envEmailDefault: Boolean(config.SENDGRID_API_KEY && config.MAIL_FROM),
        envSmsDefault: config.smsProvider ?? '',
      },
    });
  }),
);

const messagingSchema = z.object({
  emailProvider: z.enum(['sendgrid', 'acs']).or(z.literal('')).optional(),
  mailFrom: z.string().optional(),
  acsMailFrom: z.string().optional(),
  sendgridApiKey: z.string().optional(),
  smsProvider: z.enum(['twilio', 'azure']).or(z.literal('')).optional(),
  smsFrom: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  acsSmsFrom: z.string().optional(),
  acsConnectionString: z.string().optional(),
});

settingsRouter.put(
  '/messaging',
  authenticate,
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const body = messagingSchema.parse(req.body);
    const current = (await currentOrg()).messaging ?? {};
    const next: MessagingSettings = { ...current };

    // Non-secret identifiers: apply as given (empty string clears).
    if (body.emailProvider !== undefined) next.emailProvider = body.emailProvider === '' ? undefined : body.emailProvider;
    if (body.mailFrom !== undefined) next.mailFrom = body.mailFrom || undefined;
    if (body.acsMailFrom !== undefined) next.acsMailFrom = body.acsMailFrom || undefined;
    if (body.smsFrom !== undefined) next.smsFrom = body.smsFrom || undefined;
    if (body.twilioAccountSid !== undefined) next.twilioAccountSid = body.twilioAccountSid || undefined;
    if (body.acsSmsFrom !== undefined) next.acsSmsFrom = body.acsSmsFrom || undefined;
    if (body.smsProvider !== undefined) next.smsProvider = body.smsProvider === '' ? undefined : body.smsProvider;

    // Secrets: only overwrite when a non-empty value is supplied (the UI sends
    // blank to mean "leave unchanged"). To clear, we'd add an explicit action.
    if (body.sendgridApiKey) next.sendgridApiKey = body.sendgridApiKey;
    if (body.twilioAuthToken) next.twilioAuthToken = body.twilioAuthToken;
    if (body.acsConnectionString) next.acsConnectionString = body.acsConnectionString;

    await db.update(organisations).set({ messaging: next, updatedAt: new Date() }).where(eq(organisations.id, 1));
    res.json({ data: { ok: true } });
  }),
);

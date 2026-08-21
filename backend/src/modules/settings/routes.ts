import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { organisations, type MessagingSettings } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { config } from '../../config.js';
import { resolveMessaging, verifyEmail } from '../messages/delivery.js';
import { brandedEmailHtml, renderText, localeName } from '../messages/render.js';

export const settingsRouter = Router();

// Professional email presentation (non-secret). Empty strings are allowed and
// treated as "unset" downstream; the whole object replaces the stored value.
const emailSettingsSchema = z.object({
  replyTo: z.string().email().or(z.literal('')).optional(),
  website: z.string().max(300).optional(),
  signature: z.record(z.string()).optional(),
  social: z.object({
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    youtube: z.string().optional(),
  }).optional(),
  showContactFooter: z.boolean().optional(),
  buttonColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).or(z.literal('')).optional(),
});

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
  // Hex colour like #7c3aed or #7c3aedff; null clears it (fall back to palette).
  brandColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  arabicEnabled: z.boolean().optional(),
  emailSettings: emailSettingsSchema.optional(),
  // #17: which dashboard widgets are enabled, in display order. Accept any widget
  // key (the frontend filters to its known catalog) so new cards don't need a
  // schema change each release.
  dashboard: z.object({
    widgets: z.array(z.string().max(40)).max(30),
  }).optional(),
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
        whatsappFrom: m.whatsappFrom ?? '',
        whatsappProvider: m.whatsappProvider ?? '',
        acsWhatsappChannelId: m.acsWhatsappChannelId ?? '',
        aiProvider: m.aiProvider ?? '',
        aiModel: m.aiModel ?? '',
        aiApiKeySet: Boolean(m.aiApiKey),
        azureOpenaiEndpoint: m.azureOpenaiEndpoint ?? '',
        azureOpenaiDeployment: m.azureOpenaiDeployment ?? '',
        azureOpenaiApiVersion: m.azureOpenaiApiVersion ?? '',
        azureOpenaiKeySet: Boolean(m.azureOpenaiKey),
        // Surfaced so admins know an env default is active even if unset here.
        envEmailDefault: Boolean(config.SENDGRID_API_KEY && config.MAIL_FROM),
        envSmsDefault: config.smsProvider ?? '',
        envAiDefault: Boolean(config.ANTHROPIC_API_KEY),
        envAzureAiDefault: Boolean(config.AZURE_OPENAI_ENDPOINT && config.AZURE_OPENAI_KEY),
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
  whatsappFrom: z.string().optional(),
  whatsappProvider: z.enum(['twilio', 'azure']).or(z.literal('')).optional(),
  acsWhatsappChannelId: z.string().optional(),
  aiProvider: z.enum(['anthropic', 'azure']).or(z.literal('')).optional(),
  aiModel: z.string().optional(),
  aiApiKey: z.string().optional(),
  azureOpenaiEndpoint: z.string().optional(),
  azureOpenaiDeployment: z.string().optional(),
  azureOpenaiApiVersion: z.string().optional(),
  azureOpenaiKey: z.string().optional(),
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
    if (body.whatsappFrom !== undefined) next.whatsappFrom = body.whatsappFrom || undefined;
    if (body.acsWhatsappChannelId !== undefined) next.acsWhatsappChannelId = body.acsWhatsappChannelId || undefined;
    if (body.whatsappProvider !== undefined) next.whatsappProvider = body.whatsappProvider === '' ? undefined : body.whatsappProvider;
    // Back-compat: if a Twilio WhatsApp sender is set but no provider was chosen,
    // default to Twilio (preserves the old auto-behaviour).
    if (!next.whatsappProvider && next.whatsappFrom) next.whatsappProvider = 'twilio';
    if (body.aiProvider !== undefined) next.aiProvider = body.aiProvider === '' ? undefined : body.aiProvider;
    if (body.aiModel !== undefined) next.aiModel = body.aiModel || undefined;
    if (body.azureOpenaiEndpoint !== undefined) next.azureOpenaiEndpoint = body.azureOpenaiEndpoint || undefined;
    if (body.azureOpenaiDeployment !== undefined) next.azureOpenaiDeployment = body.azureOpenaiDeployment || undefined;
    if (body.azureOpenaiApiVersion !== undefined) next.azureOpenaiApiVersion = body.azureOpenaiApiVersion || undefined;

    // Secrets: only overwrite when a non-empty value is supplied (the UI sends
    // blank to mean "leave unchanged"). To clear, we'd add an explicit action.
    if (body.sendgridApiKey) next.sendgridApiKey = body.sendgridApiKey;
    if (body.twilioAuthToken) next.twilioAuthToken = body.twilioAuthToken;
    if (body.acsConnectionString) next.acsConnectionString = body.acsConnectionString;
    if (body.aiApiKey) next.aiApiKey = body.aiApiKey;
    if (body.azureOpenaiKey) next.azureOpenaiKey = body.azureOpenaiKey;

    await db.update(organisations).set({ messaging: next, updatedAt: new Date() }).where(eq(organisations.id, 1));
    res.json({ data: { ok: true } });
  }),
);

// Diagnostic: send a real test email and return the exact result so an admin can
// confirm email works (this is why password-reset codes weren't arriving).
settingsRouter.post(
  '/messaging/test-email',
  authenticate,
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const to = z.object({ to: z.string().email() }).parse(req.body).to;
    const org = await currentOrg();
    const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
    res.json({ data: await verifyEmail(messaging, to) });
  }),
);

// Live email preview: render the real branded shell with sample content, using
// the saved org merged with any draft email settings from the editor. Returns
// HTML the Settings page shows in an iframe so admins see exactly what members
// will get. Admin-only; renders only sample text (no recipient data).
settingsRouter.post(
  '/email-preview',
  authenticate,
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    // Accept the editor's unsaved draft (brand + contact + email settings) so the
    // preview reflects changes before Save. All lenient — the renderer tolerates
    // bad values (invalid hex/logo fall back safely).
    const draft = z.object({
      name: z.record(z.string()).optional(),
      brandColor: z.string().optional(),
      logoPath: z.string().nullable().optional(),
      addressLine1: z.string().nullable().optional(),
      addressLine2: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      emailSettings: emailSettingsSchema.optional(),
    }).parse(req.body);
    const org = await currentOrg();
    const { emailSettings: draftEs, ...draftOrg } = draft;
    const merged = { ...org, ...draftOrg, emailSettings: { ...(org.emailSettings ?? {}), ...(draftEs ?? {}) } };
    const lang = org.locale || 'en';
    const churchName = localeName(org.name, lang) || 'Our Church';
    const sampleCtx = { firstName: 'Sarah', fullName: 'Sarah Hana', churchName, date: new Date().toISOString().slice(0, 10) };
    const body =
      `Dear ${sampleCtx.firstName},\n\n` +
      `This is a preview of how your church emails will look. Update the logo, colours, sign-off, and footer here and everything — reminders, welcomes, birthday wishes, and announcements — will match.\n\n` +
      `We're so glad you're part of ${churchName}.`;
    const signature = renderText(localeName(merged.emailSettings?.signature, lang), sampleCtx) || undefined;
    const html = brandedEmailHtml(body, merged, {
      lang,
      signature,
      cta: { label: 'View this Sunday', url: '#' },
      unsubscribeUrl: '#',
      preheader: 'A preview of your branded church email',
    });
    res.json({ data: { html } });
  }),
);

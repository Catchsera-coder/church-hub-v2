import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail fast on bad/missing config at boot rather than at the first request.
 * (v1 lesson: surface problems early, in one place.)
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Public URL of the SPA, used to build links in emails (password reset). If
  // unset, reset emails include the token and a relative /reset-password path.
  PUBLIC_APP_URL: z.string().url().optional(),
  DEFAULT_LOCALE: z.string().default('en'),
  DEFAULT_CURRENCY: z.string().default('USD'),
  DEFAULT_TIMEZONE: z.string().default('UTC'),

  // Messaging providers (all optional, per-deploy). Everything is called over
  // HTTP with fetch/crypto, so there is no SDK dependency. When a channel has no
  // provider configured, delivery.ts reports failure honestly (no fake 'sent').
  // See docs/RUNNING.md. Each church deploy picks its own provider(s).
  MAIL_FROM: z.string().email().optional(),
  SENDGRID_API_KEY: z.string().optional(),

  // SMS can run on Twilio OR Azure Communication Services. Leave SMS_PROVIDER
  // unset to auto-pick whichever is configured (Azure preferred when both are);
  // set it to force one.
  SMS_PROVIDER: z.enum(['twilio', 'azure']).optional(),
  // Twilio:
  SMS_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Azure Communication Services (SMS): connection string + an ACS phone number.
  ACS_CONNECTION_STRING: z.string().optional(),
  ACS_SMS_FROM: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const d = parsed.data;
const twilioSmsReady = Boolean(d.TWILIO_ACCOUNT_SID && d.TWILIO_AUTH_TOKEN && d.SMS_FROM);
const azureSmsReady = Boolean(d.ACS_CONNECTION_STRING && d.ACS_SMS_FROM);

/** Pick the SMS provider: honour an explicit choice, else auto-detect. */
function resolveSmsProvider(): 'twilio' | 'azure' | null {
  if (d.SMS_PROVIDER === 'twilio') return twilioSmsReady ? 'twilio' : null;
  if (d.SMS_PROVIDER === 'azure') return azureSmsReady ? 'azure' : null;
  if (azureSmsReady) return 'azure';
  if (twilioSmsReady) return 'twilio';
  return null;
}

const smsProvider = resolveSmsProvider();

export const config = {
  ...d,
  isProd: d.NODE_ENV === 'production',
  corsOrigins: d.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  emailEnabled: Boolean(d.SENDGRID_API_KEY && d.MAIL_FROM),
  smsProvider,
  smsEnabled: smsProvider !== null,
};

export type Config = typeof config;

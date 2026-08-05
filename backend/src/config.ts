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
  DEFAULT_LOCALE: z.string().default('en'),
  DEFAULT_CURRENCY: z.string().default('USD'),
  DEFAULT_TIMEZONE: z.string().default('UTC'),

  // Messaging providers (all optional). Email via SendGrid HTTP API, SMS via
  // Twilio HTTP API — both called with fetch, so no SDK dependency. When a
  // channel's vars are absent, delivery.ts reports failure honestly (no fake
  // 'sent'). See docs/RUNNING.md.
  MAIL_FROM: z.string().email().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SMS_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  emailEnabled: Boolean(parsed.data.SENDGRID_API_KEY && parsed.data.MAIL_FROM),
  smsEnabled: Boolean(parsed.data.TWILIO_ACCOUNT_SID && parsed.data.TWILIO_AUTH_TOKEN && parsed.data.SMS_FROM),
};

export type Config = typeof config;

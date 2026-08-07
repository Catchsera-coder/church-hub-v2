import type { Config } from 'drizzle-kit';
import 'dotenv/config';

// Ensure SSL when talking to a managed Postgres (Azure requires it). `push` uses
// this URL directly, so append sslmode in prod if not already present.
const raw = process.env.DATABASE_URL ?? '';
const url = raw && process.env.NODE_ENV === 'production' && !/sslmode=/.test(raw)
  ? raw + (raw.includes('?') ? '&' : '?') + 'sslmode=require'
  : raw;

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  // No `strict` — it forces an interactive confirmation prompt, which the
  // container (no TTY) can't answer, so push would abort. The deploy relies on
  // `drizzle-kit push --force` to apply additive changes non-interactively.
} satisfies Config;

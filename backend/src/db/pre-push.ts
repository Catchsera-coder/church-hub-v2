import { pool } from './index.js';

/**
 * Guarded, idempotent DDL that must run BEFORE `drizzle-kit push` on deploy.
 *
 * Why this exists: drizzle-kit push is reliable for ADDITIVE changes (new
 * tables/columns) but Postgres enum-value additions are the one case that can
 * make it try to drop & recreate the type — destructive against a live column.
 * So we add new enum values here first with `ALTER TYPE ... ADD VALUE IF NOT
 * EXISTS` (idempotent; runs outside a transaction, which ADD VALUE requires).
 * Then push sees the live enum already matching schema.ts and does nothing to
 * it. Safe to run on every boot and on a brand-new DB (where the type does not
 * exist yet — we tolerate that and let push create it fresh with all values).
 *
 * Add future guarded enum/value migrations to STATEMENTS below.
 */
const STATEMENTS = [
  // #20a: WhatsApp as a campaign channel.
  `ALTER TYPE "campaign_channel" ADD VALUE IF NOT EXISTS 'whatsapp'`,
];

async function main() {
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
      // eslint-disable-next-line no-console
      console.log(`[pre-push] ok: ${sql}`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // 42704 = undefined_object: the type doesn't exist yet on a fresh DB;
      // drizzle-kit push will create it with the full value set. Anything else
      // is a real problem — surface it and fail the deploy.
      if (code === '42704') {
        // eslint-disable-next-line no-console
        console.log(`[pre-push] skip (type not created yet): ${sql}`);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`[pre-push] failed: ${sql}`, err);
      throw err;
    }
  }
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[pre-push] migration failed', err);
  process.exit(1);
});

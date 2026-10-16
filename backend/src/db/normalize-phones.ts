import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db, pool } from './index.js';
import { people, households, vendors, organisations } from './schema.js';
import { normalizePhone } from '../lib/phone.js';

/**
 * One-time (idempotent) data repair: rewrite every stored phone number to the
 * clean international form (E.164) so SMS/WhatsApp work. Runs on each deploy AFTER
 * drizzle-kit push. Only touches values not already starting with "+", so once a
 * value is normalised it is skipped; a number that cannot be made valid is left
 * untouched (never destroy real data). Safe to run repeatedly.
 */
async function fixField(
  label: string,
  rows: Array<{ id: number; val: string | null }>,
  update: (id: number, v: string) => Promise<unknown>,
): Promise<void> {
  let fixed = 0;
  let unparseable = 0;
  for (const r of rows) {
    const norm = normalizePhone(r.val);
    if (norm && norm !== r.val) { await update(r.id, norm); fixed++; }
    else if (!norm) unparseable++;
  }
  // eslint-disable-next-line no-console
  console.log(`[normalize-phones] ${label}: checked ${rows.length}, fixed ${fixed}, left ${unparseable} unparseable`);
}

async function main(): Promise<void> {
  try {
    const notE164 = (col: Parameters<typeof isNotNull>[0]) => and(isNotNull(col), ne(col as never, '' as never), sql`${col} NOT LIKE '+%'`);

    const ppl = await db.select({ id: people.id, val: people.mobile }).from(people).where(notE164(people.mobile));
    await fixField('people.mobile', ppl, (id, v) => db.update(people).set({ mobile: v }).where(eq(people.id, id)));

    const hh = await db.select({ id: households.id, val: households.homePhone }).from(households).where(notE164(households.homePhone));
    await fixField('households.home_phone', hh, (id, v) => db.update(households).set({ homePhone: v }).where(eq(households.id, id)));

    const vph = await db.select({ id: vendors.id, val: vendors.phone }).from(vendors).where(notE164(vendors.phone));
    await fixField('vendors.phone', vph, (id, v) => db.update(vendors).set({ phone: v }).where(eq(vendors.id, id)));

    const vmo = await db.select({ id: vendors.id, val: vendors.mobile }).from(vendors).where(notE164(vendors.mobile));
    await fixField('vendors.mobile', vmo, (id, v) => db.update(vendors).set({ mobile: v }).where(eq(vendors.id, id)));

    const org = await db.select({ id: organisations.id, val: organisations.phone }).from(organisations).where(notE164(organisations.phone));
    await fixField('org.phone', org, (id, v) => db.update(organisations).set({ phone: v }).where(eq(organisations.id, id)));
  } catch (err) {
    // Never block startup over a data-repair step.
    // eslint-disable-next-line no-console
    console.error('[normalize-phones] skipped (non-fatal):', err instanceof Error ? err.message : err);
  }
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[normalize-phones] error (non-fatal):', err);
});

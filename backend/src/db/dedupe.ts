import { pool } from './index.js';

/**
 * One-time (idempotent) cleanup of duplicate rows that a non-idempotent seed
 * created. Runs on every deploy AFTER `drizzle-kit push` (so tables exist) and
 * BEFORE seed. Safe to run repeatedly: once there are no duplicates every
 * statement is a no-op.
 *
 * Only `service_types` (Ministries) is affected: the seed inserted defaults with
 * `onConflictDoNothing()` but there is no unique key on the name, so each
 * container start re-inserted them. Funds/roles/permissions/users are all
 * unique-guarded and never duplicated.
 *
 * Duplicates are collapsed onto the lowest id per identical name; any rosters or
 * attendance events pointing at a duplicate are repointed to the survivor first
 * so no data is lost, then the extra rows are deleted. Never fails the deploy —
 * a dedupe error is logged and the container still starts.
 */
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keep = `(SELECT id, MIN(id) OVER (PARTITION BY name::text) AS keep_id FROM service_types)`;

    // Repoint ministry rosters to the survivor, skipping any that would collide
    // with an existing (person, survivor) pair.
    const repointed = await client.query(`
      UPDATE person_service_type p SET service_type_id = k.keep_id
      FROM ${keep} k
      WHERE p.service_type_id = k.id AND k.id <> k.keep_id
        AND NOT EXISTS (
          SELECT 1 FROM person_service_type p2
          WHERE p2.person_id = p.person_id AND p2.service_type_id = k.keep_id
        )`);
    // Drop roster rows that couldn't be repointed (survivor already assigned).
    await client.query(`
      DELETE FROM person_service_type p USING ${keep} k
      WHERE p.service_type_id = k.id AND k.id <> k.keep_id`);
    // Repoint attendance events to the survivor.
    await client.query(`
      UPDATE attendance_events a SET service_type_id = k.keep_id
      FROM ${keep} k
      WHERE a.service_type_id = k.id AND k.id <> k.keep_id`);
    // Finally delete the duplicate service types.
    const deleted = await client.query(`
      DELETE FROM service_types s USING ${keep} k
      WHERE s.id = k.id AND k.id <> k.keep_id`);

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`[dedupe] service_types: removed ${deleted.rowCount} duplicate(s), repointed ${repointed.rowCount} roster row(s)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Never block startup over a cleanup step.
    // eslint-disable-next-line no-console
    console.error('[dedupe] skipped (non-fatal):', err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[dedupe] error (non-fatal):', err);
});

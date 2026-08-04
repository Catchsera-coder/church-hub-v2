import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';

// Run generated SQL migrations. Called in CI and on deploy (co-located with the DB).
async function main() {
  await migrate(db, { migrationsFolder: './drizzle' });
  // eslint-disable-next-line no-console
  console.log('migrations applied');
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('migration failed', err);
  process.exit(1);
});

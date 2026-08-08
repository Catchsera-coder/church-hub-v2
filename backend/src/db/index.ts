import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

// A single shared pool. Postgres does not auto-index FK columns, so indexes are
// declared explicitly in the schema (v1 lesson).
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // Per-replica pool; keep replicas × max under the server's max_connections.
  max: config.DB_POOL_MAX,
  // In prod, optionally verify the server cert (DB_SSL_STRICT) to prevent MITM.
  ssl: config.isProd ? { rejectUnauthorized: config.DB_SSL_STRICT } : undefined,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };

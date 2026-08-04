import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

// A single shared pool. Postgres does not auto-index FK columns, so indexes are
// declared explicitly in the schema (v1 lesson).
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // Keep this modest; Container Apps replicas each hold a pool.
  max: 10,
  ssl: config.isProd ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };

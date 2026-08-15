// One-off Super Admin recovery for any Church Hub deployment.
//
// Tenant-neutral: reads the target account from ADMIN_EMAIL / ADMIN_PASSWORD
// (the same env vars the seeder uses). Unlike the seeder, this UPSERTS — it
// creates the admin if missing, or resets the password of an existing admin —
// and always ensures the Super Admin role. Safe to run against any church's DB.
//
// Run (production container):  node dist/db/reset-admin.js
// Run (local dev):             npx tsx src/db/reset-admin.ts
// Inline credentials:          ADMIN_EMAIL=you@church.org ADMIN_PASSWORD=secret <cmd>
//
// Exists because password reset over email needs a configured mail sender;
// until that is wired per tenant, this is the reliable recovery path.

import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { users, roles, userRoles } from './schema.js';
import { hashPassword } from '../auth/password.js';
import { config } from '../config.js';

const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';
if (!email || !password) {
  console.error('MISSING ADMIN_EMAIL or ADMIN_PASSWORD');
  process.exit(1);
}

const hash = await hashPassword(password);
let userId: number;
const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing.length) {
  await db.update(users).set({ passwordHash: hash }).where(eq(users.email, email));
  userId = (existing[0] as any).id;
  console.log('Updated password for existing admin: ' + email);
} else {
  const ins = await db
    .insert(users)
    .values({ name: 'Administrator', email, passwordHash: hash, locale: config.DEFAULT_LOCALE })
    .returning();
  userId = (ins[0] as any).id;
  console.log('Created new admin: ' + email);
}

const sr = await db.select().from(roles).where(eq(roles.name, 'Super Admin')).limit(1);
if (sr.length) {
  await db.insert(userRoles).values({ userId, roleId: (sr[0] as any).id }).onConflictDoNothing();
  console.log('Super Admin role ensured.');
} else {
  console.log('WARN: Super Admin role not found - run db:seed first.');
}
process.exit(0);

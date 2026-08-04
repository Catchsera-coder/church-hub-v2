import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { organisations, users, roles, permissions, userRoles, rolePermissions, funds, serviceTypes } from './schema.js';
import { hashPassword } from '../auth/password.js';
import { config } from '../config.js';

const RESOURCES = ['person', 'household', 'ministry', 'attendance', 'contribution', 'batch', 'fund', 'sermon', 'event', 'message', 'user'];
const ACTIONS = ['view', 'create', 'update', 'delete'];

const ROLE_MATRIX: Record<string, string[] | '*'> = {
  'Super Admin': '*', // bypasses checks in code; kept here for completeness
  Admin: '*',
  Finance: ['view contribution', 'create contribution', 'update contribution', 'view fund', 'create fund', 'update fund', 'view batch', 'create batch', 'update batch', 'view person'],
  Staff: ['view person', 'create person', 'update person', 'view household', 'create household', 'update household', 'view attendance', 'create attendance', 'view ministry'],
  Volunteer: ['view person', 'view attendance', 'create attendance'],
};

async function seed() {
  // Organisation (white-label) row.
  await db.insert(organisations).values({
    id: 1,
    name: { en: 'Your Church', ar: 'كنيستك' },
    currency: config.DEFAULT_CURRENCY,
    timezone: config.DEFAULT_TIMEZONE,
    locale: config.DEFAULT_LOCALE,
  }).onConflictDoNothing();

  // Permissions.
  const permNames = RESOURCES.flatMap((r) => ACTIONS.map((a) => `${a} ${r}`));
  for (const name of permNames) await db.insert(permissions).values({ name }).onConflictDoNothing();
  const allPerms = await db.select().from(permissions);
  const permByName = new Map(allPerms.map((p) => [p.name, p.id]));

  // Roles + role_permissions.
  for (const [roleName, grants] of Object.entries(ROLE_MATRIX)) {
    await db.insert(roles).values({ name: roleName }).onConflictDoNothing();
    const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
    if (!role) continue;
    const names = grants === '*' ? permNames : grants;
    for (const n of names) {
      const pid = permByName.get(n);
      if (pid) await db.insert(rolePermissions).values({ roleId: role.id, permissionId: pid }).onConflictDoNothing();
    }
  }

  // First Super Admin user.
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.org').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe!12345';
  await db.insert(users).values({ name: 'Administrator', email, passwordHash: await hashPassword(password), locale: config.DEFAULT_LOCALE }).onConflictDoNothing();
  const [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const [superRole] = await db.select().from(roles).where(eq(roles.name, 'Super Admin')).limit(1);
  if (admin && superRole) await db.insert(userRoles).values({ userId: admin.id, roleId: superRole.id }).onConflictDoNothing();

  // Default funds.
  const fundSeed = [
    { code: 'GENERAL', name: { en: 'General', ar: 'عام' } },
    { code: 'MISSIONS', name: { en: 'Missions', ar: 'الإرساليات' } },
    { code: 'BUILDING', name: { en: 'Building', ar: 'المبنى' } },
  ];
  for (const [i, f] of fundSeed.entries()) {
    await db.insert(funds).values({ code: f.code, name: f.name, sortOrder: i + 1 }).onConflictDoNothing();
  }

  // Default ministries (service types).
  const ministrySeed = [
    { en: 'Sunday Worship', ar: 'عبادة الأحد' },
    { en: 'Prayer Meeting', ar: 'اجتماع الصلاة' },
    { en: 'Bible Study', ar: 'درس الكتاب' },
    { en: 'Youth', ar: 'الشباب' },
    { en: 'Sunday School', ar: 'مدرسة الأحد' },
  ];
  for (const [i, m] of ministrySeed.entries()) {
    await db.insert(serviceTypes).values({ name: m, sortOrder: i + 1 }).onConflictDoNothing();
  }

  // eslint-disable-next-line no-console
  console.log(`seed complete. Super Admin: ${email} (change the password!)`);
  await pool.end();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed', err);
  process.exit(1);
});

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from './index.js';
import { organisations, users, roles, permissions, userRoles, rolePermissions, funds, serviceTypes, checkinForms, messageTemplates, people } from './schema.js';
import { hashPassword } from '../auth/password.js';
import { config } from '../config.js';
import { DEFAULT_FORM_FIELDS } from '../modules/checkin/forms.routes.js';

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

  // Default ministries (service types). Only seed when the table is EMPTY —
  // service_types has no unique key, so re-inserting on every startup would
  // duplicate them (the bug that produced 7× "Sunday Worship"). First run only.
  const [{ count: serviceCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(serviceTypes);
  if (serviceCount === 0) {
    const ministrySeed = [
      { en: 'Sunday Worship', ar: 'عبادة الأحد' },
      { en: 'Prayer Meeting', ar: 'اجتماع الصلاة' },
      { en: 'Bible Study', ar: 'درس الكتاب' },
      { en: 'Youth', ar: 'الشباب' },
      { en: 'Sunday School', ar: 'مدرسة الأحد' },
    ];
    for (const [i, m] of ministrySeed.entries()) {
      await db.insert(serviceTypes).values({ name: m, sortOrder: i + 1 });
    }
  }

  // Default check-in / connect form (Phase 3). Seed once (idempotent on isDefault).
  const [{ count: formCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(checkinForms);
  if (formCount === 0) {
    await db.insert(checkinForms).values({
      name: { en: 'Connect Card', ar: 'بطاقة تعارف' },
      intro: { en: "Welcome! Tell us a little about you so we can stay in touch.", ar: 'أهلاً بك! أخبرنا القليل عنك لنبقى على تواصل.' },
      fields: DEFAULT_FORM_FIELDS,
      isDefault: true,
    });
  }

  // Starter message templates with merge fields (used by Phase 5 automations).
  const [{ count: tplCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(messageTemplates);
  if (tplCount === 0) {
    await db.insert(messageTemplates).values([
      {
        name: 'Birthday greeting', channel: 'email',
        subject: { en: 'Happy Birthday, {{firstName}}! 🎂', ar: 'عيد ميلاد سعيد يا {{firstName}}! 🎂' },
        header: { en: 'Happy birthday from {{churchName}}', ar: 'عيد ميلاد سعيد من {{churchName}}' },
        body: { en: 'Dear {{firstName}},\n\nWishing you a joyful birthday! May God bless you richly in the year ahead. We thank Him for you.', ar: 'عزيزي {{firstName}}،\n\nنتمنى لك عيد ميلاد مليئاً بالفرح! بارك الله حياتك في العام القادم. نشكر الله من أجلك.' },
        footer: { en: 'With love, the {{churchName}} family', ar: 'بمحبة، عائلة {{churchName}}' },
      },
      {
        name: 'Membership anniversary', channel: 'email',
        subject: { en: 'Celebrating you, {{firstName}} 🎉', ar: 'نحتفل بك يا {{firstName}} 🎉' },
        header: { en: 'A special day at {{churchName}}', ar: 'يوم مميز في {{churchName}}' },
        body: { en: 'Dear {{firstName}},\n\nToday marks another year since you joined our church family. Thank you for being part of {{churchName}}!', ar: 'عزيزي {{firstName}}،\n\nيصادف اليوم عاماً آخر منذ انضمامك إلى عائلة كنيستنا. شكراً لكونك جزءاً من {{churchName}}!' },
        footer: { en: 'In Christ, the {{churchName}} team', ar: 'في المسيح، فريق {{churchName}}' },
      },
      {
        name: 'Welcome', channel: 'email',
        subject: { en: 'Welcome to {{churchName}}, {{firstName}}!', ar: 'أهلاً بك في {{churchName}} يا {{firstName}}!' },
        header: { en: 'Welcome!', ar: 'أهلاً وسهلاً!' },
        body: { en: 'Hi {{firstName}},\n\nWe are so glad you joined us at {{churchName}}. If there is anything we can pray for or help with, just reply to this message.', ar: 'مرحباً {{firstName}}،\n\nيسعدنا انضمامك إلينا في {{churchName}}. إن كان هناك ما يمكننا الصلاة من أجله أو مساعدتك به، فقط ردّ على هذه الرسالة.' },
        footer: { en: 'Blessings, the {{churchName}} team', ar: 'بركات، فريق {{churchName}}' },
      },
    ]);
  }

  // Broadcast starter templates for the whole group — reminders, announcements,
  // congratulations. Added idempotently BY NAME so existing deploys (whose
  // template table is non-empty) pick them up too, not just fresh installs.
  const starters = [
    {
      name: 'Service reminder', channel: 'email' as const,
      subject: { en: 'Reminder: {{churchName}} this Sunday', ar: 'تذكير: {{churchName}} هذا الأحد' },
      header: { en: 'See you this Sunday', ar: 'نراكم هذا الأحد' },
      body: { en: 'Dear {{firstName}},\n\nThis is a friendly reminder about our gathering this Sunday. We would love to see you and your family there!', ar: 'عزيزي {{firstName}}،\n\nهذا تذكير ودّي باجتماعنا هذا الأحد. يسعدنا رؤيتك أنت وعائلتك هناك!' },
      footer: { en: 'Times and location are on our website.', ar: 'المواعيد والموقع على موقعنا الإلكتروني.' },
    },
    {
      name: 'Announcement', channel: 'email' as const,
      subject: { en: 'A note from {{churchName}}', ar: 'رسالة من {{churchName}}' },
      header: { en: 'Announcement', ar: 'إعلان' },
      body: { en: 'Dear {{firstName}},\n\nWe wanted to share some news with you.\n\n[Write your announcement here.]', ar: 'عزيزي {{firstName}}،\n\nأردنا مشاركة بعض الأخبار معك.\n\n[اكتب إعلانك هنا.]' },
      footer: { en: '', ar: '' },
    },
    {
      name: 'Congratulations', channel: 'email' as const,
      subject: { en: 'Congratulations, {{firstName}}! 🎉', ar: 'مبروك يا {{firstName}}! 🎉' },
      header: { en: 'Rejoicing with you', ar: 'نفرح معك' },
      body: { en: 'Dear {{firstName}},\n\nWe rejoice with you and celebrate this special moment with your family. May God continue to bless you abundantly!', ar: 'عزيزي {{firstName}}،\n\nنفرح معك ونحتفل بهذه اللحظة المميزة مع عائلتك. ليبارك الله حياتك بوفرة!' },
      footer: { en: 'With joy, the {{churchName}} family', ar: 'بفرح، عائلة {{churchName}}' },
    },
  ];
  for (const s of starters) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(messageTemplates).where(eq(messageTemplates.name, s.name));
    if (count === 0) await db.insert(messageTemplates).values(s);
  }

  // Data repair (idempotent): a self-registered visitor should be ACTIVE. Some
  // historical rows were left is_active=false, so they appeared on the family
  // page but were excluded from member counts, messaging audiences, and
  // analytics. Reactivate only never-reviewed self-registered people (the clear
  // anomaly) so a deliberately-deactivated member is never touched.
  await db.update(people)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(eq(people.selfRegistered, true), eq(people.isActive, false), isNull(people.reviewedAt), isNull(people.deletedAt)));

  // eslint-disable-next-line no-console
  console.log(`seed complete. Super Admin: ${email} (change the password!)`);
  await pool.end();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed failed', err);
  process.exit(1);
});

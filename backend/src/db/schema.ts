/**
 * Data model (Drizzle / Postgres).
 *
 * Design rules carried from v1:
 *  - Money is ALWAYS integer minor units (bigint). Never floats.
 *  - Giving is an append-only ledger: a correction is a new negative row with
 *    `reverses_id`; originals are never edited or deleted.
 *  - Translatable text is JSONB keyed by locale: { "en": "...", "ar": "..." }.
 *  - Single organisation row per deployment (white-label per deploy). The deploy
 *    IS the tenant boundary, so tenant-scoped tables need no org_id.
 *  - Postgres does not auto-index FK columns — hot FKs/dates are indexed here.
 */
import {
  pgTable, pgEnum, serial, integer, bigint, varchar, text, boolean,
  timestamp, date, jsonb, uuid, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

type I18n = Record<string, string>;

/**
 * Per-church messaging config, editable from the Settings tab (stored here so a
 * church can change providers/keys without a redeploy — env stays the default).
 * Secrets live in this row; the PUBLIC settings read strips them.
 */
export type MessagingSettings = {
  emailProvider?: 'sendgrid' | 'acs';
  sendgridApiKey?: string;
  mailFrom?: string;
  acsMailFrom?: string; // ACS verified sender, e.g. DoNotReply@<your-domain>
  smsProvider?: 'twilio' | 'azure';
  smsFrom?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  acsConnectionString?: string; // shared by ACS email + SMS
  acsSmsFrom?: string;
  // WhatsApp via Twilio (reuses the Twilio account; from is a WhatsApp sender).
  whatsappProvider?: 'twilio';
  whatsappFrom?: string; // e.g. "whatsapp:+14155238886"
  // AI compose assistant (Anthropic). Off until a key is supplied here or in env.
  aiApiKey?: string;
  aiModel?: string; // defaults to claude-opus-5
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const membershipStatus = pgEnum('membership_status', ['visitor', 'regular', 'member', 'inactive']);
export const ageGroup = pgEnum('age_group', ['children', 'youth', 'adult']);
export const contributionMethod = pgEnum('contribution_method', ['cash', 'cheque', 'card', 'bank', 'other']);
// 'whatsapp' is APPENDED (end position) so the value can be added to the live
// enum with `ALTER TYPE ... ADD VALUE` — see src/db/pre-push.ts, which applies
// it idempotently before drizzle-kit push so push never tries to recreate it.
export const campaignChannel = pgEnum('campaign_channel', ['email', 'sms', 'whatsapp']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'scheduled', 'sending', 'sent', 'failed']);
export const recipientStatus = pgEnum('recipient_status', ['pending', 'sent', 'failed']);
export const activityEvent = pgEnum('activity_event', ['created', 'updated', 'deleted']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

// ---------------------------------------------------------------------------
// Organisation (white-label settings) — single row (id = 1)
// ---------------------------------------------------------------------------
export const organisations = pgTable('organisations', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  locale: varchar('locale', { length: 8 }).notNull().default('en'),
  logoPath: text('logo_path'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: varchar('city', { length: 120 }),
  region: varchar('region', { length: 120 }),
  postalCode: varchar('postal_code', { length: 20 }),
  country: varchar('country', { length: 120 }),
  email: varchar('email', { length: 190 }),
  phone: varchar('phone', { length: 40 }),
  // Default language is English; Arabic becomes selectable only when enabled here.
  arabicEnabled: boolean('arabic_enabled').notNull().default(false),
  messaging: jsonb('messaging').$type<MessagingSettings>().notNull().default({}),
  // Dashboard customization (#17): which stat widgets show, in order. Empty =
  // show the default set. Per-church (white-label), set by an Admin in Settings.
  dashboard: jsonb('dashboard').$type<{ widgets?: string[] }>().notNull().default({}),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Auth / RBAC
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 190 }).notNull(),
  email: varchar('email', { length: 190 }).notNull(),
  passwordHash: text('password_hash'),
  locale: varchar('locale', { length: 8 }).notNull().default('en'),
  isActive: boolean('is_active').notNull().default(true),
  personId: integer('person_id'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  emailUnique: uniqueIndex('users_email_unique').on(t.email),
}));

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
}, (t) => ({ nameUnique: uniqueIndex('roles_name_unique').on(t.name) }));

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
}, (t) => ({ nameUnique: uniqueIndex('permissions_name_unique').on(t.name) }));

export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: uniqueIndex('user_roles_pk').on(t.userId, t.roleId) }));

export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: uniqueIndex('role_permissions_pk').on(t.roleId, t.permissionId) }));

export const refreshTokens = pgTable('refresh_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userIdx: index('refresh_tokens_user_idx').on(t.userId),
  hashIdx: index('refresh_tokens_hash_idx').on(t.tokenHash),
}));

// Password reset: opaque token, only the SHA-256 hash stored; single-use + expiry.
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  hashIdx: index('password_reset_tokens_hash_idx').on(t.tokenHash),
}));

// ---------------------------------------------------------------------------
// Congregation
// ---------------------------------------------------------------------------
export const households = pgTable('households', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  homePhone: varchar('home_phone', { length: 40 }),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: varchar('city', { length: 120 }),
  region: varchar('region', { length: 120 }),
  postalCode: varchar('postal_code', { length: 20 }),
  country: varchar('country', { length: 120 }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({ cityIdx: index('households_city_idx').on(t.city) }));

export const people = pgTable('people', {
  id: serial('id').primaryKey(),
  givenName: jsonb('given_name').$type<I18n>().notNull().default({}),
  familyName: jsonb('family_name').$type<I18n>().notNull().default({}),
  householdId: integer('household_id').references(() => households.id, { onDelete: 'set null' }),
  membershipStatus: membershipStatus('membership_status').notNull().default('visitor'),
  email: varchar('email', { length: 190 }),
  mobile: varchar('mobile', { length: 40 }),
  preferredLanguage: varchar('preferred_language', { length: 8 }).notNull().default('en'),
  dateOfBirth: date('date_of_birth'),
  photoPath: text('photo_path'),
  qrToken: uuid('qr_token').notNull().defaultRandom(),
  // Messaging consent (opt-out per channel; lawful sending suppresses these).
  emailOptOut: boolean('email_opt_out').notNull().default(false),
  smsOptOut: boolean('sms_opt_out').notNull().default(false),
  whatsappOptOut: boolean('whatsapp_opt_out').notNull().default(false),
  unsubToken: uuid('unsub_token').notNull().defaultRandom(), // one-click email unsubscribe
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  householdIdx: index('people_household_idx').on(t.householdId),
  statusIdx: index('people_status_idx').on(t.membershipStatus),
  emailIdx: index('people_email_idx').on(t.email),
  mobileIdx: index('people_mobile_idx').on(t.mobile),
  qrUnique: uniqueIndex('people_qr_unique').on(t.qrToken),
}));

// ---------------------------------------------------------------------------
// Ministries (service types) + rosters
// ---------------------------------------------------------------------------
export const serviceTypes = pgTable('service_types', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  description: jsonb('description').$type<I18n>().notNull().default({}),
  ageGroup: ageGroup('age_group'),
  defaultSchedule: varchar('default_schedule', { length: 120 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
});

export const personServiceType = pgTable('person_service_type', {
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  serviceTypeId: integer('service_type_id').notNull().references(() => serviceTypes.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: uniqueIndex('person_service_type_pk').on(t.personId, t.serviceTypeId),
  serviceIdx: index('person_service_type_service_idx').on(t.serviceTypeId),
}));

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
export const attendanceEvents = pgTable('attendance_events', {
  id: serial('id').primaryKey(),
  title: jsonb('title').$type<I18n>().notNull().default({}),
  serviceTypeId: integer('service_type_id').references(() => serviceTypes.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  // Unguessable token for the public self-check-in QR (so a scanned link can't
  // be enumerated from a sequential id).
  publicToken: uuid('public_token').notNull().defaultRandom(),
  selfCheckinOpen: boolean('self_checkin_open').notNull().default(true),
  ...timestamps,
}, (t) => ({
  startsIdx: index('attendance_events_starts_idx').on(t.startsAt),
  serviceIdx: index('attendance_events_service_idx').on(t.serviceTypeId),
  publicTokenIdx: uniqueIndex('attendance_events_public_token_idx').on(t.publicToken),
}));

export const attendanceRecords = pgTable('attendance_records', {
  id: serial('id').primaryKey(),
  attendanceEventId: integer('attendance_event_id').notNull().references(() => attendanceEvents.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }).defaultNow().notNull(),
  recordedBy: integer('recorded_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  uniquePerEvent: uniqueIndex('attendance_records_event_person_unique').on(t.attendanceEventId, t.personId),
  personIdx: index('attendance_records_person_idx').on(t.personId),
  checkedInIdx: index('attendance_records_checked_in_idx').on(t.checkedInAt),
}));

// ---------------------------------------------------------------------------
// Giving
// ---------------------------------------------------------------------------
export const funds = pgTable('funds', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  code: varchar('code', { length: 32 }).notNull(),
  isTaxDeductible: boolean('is_tax_deductible').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
}, (t) => ({ codeUnique: uniqueIndex('funds_code_unique').on(t.code) }));

export const batches = pgTable('batches', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 190 }).notNull(),
  receivedOn: date('received_on').notNull(),
  expectedTotalCents: bigint('expected_total_cents', { mode: 'number' }),
  notes: text('notes'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedByUserId: integer('closed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => ({ receivedIdx: index('batches_received_idx').on(t.receivedOn) }));

export const contributions = pgTable('contributions', {
  id: serial('id').primaryKey(),
  personId: integer('person_id').references(() => people.id, { onDelete: 'set null' }),
  householdId: integer('household_id').references(() => households.id, { onDelete: 'set null' }),
  fundId: integer('fund_id').notNull().references(() => funds.id, { onDelete: 'restrict' }),
  batchId: integer('batch_id').references(() => batches.id, { onDelete: 'set null' }),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  receivedOn: date('received_on').notNull(),
  method: contributionMethod('method').notNull().default('cash'),
  reference: varchar('reference', { length: 190 }),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  // AD-5: the contribution this row reverses (a correction), if any.
  reversesId: integer('reverses_id'),
  recordedBy: integer('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  receivedIdx: index('contributions_received_idx').on(t.receivedOn),
  fundIdx: index('contributions_fund_idx').on(t.fundId),
  personIdx: index('contributions_person_idx').on(t.personId),
  householdIdx: index('contributions_household_idx').on(t.householdId),
  batchIdx: index('contributions_batch_idx').on(t.batchId),
  reversesIdx: index('contributions_reverses_idx').on(t.reversesId),
  personDateIdx: index('contributions_person_date_idx').on(t.personId, t.receivedOn),
  fundDateIdx: index('contributions_fund_date_idx').on(t.fundId, t.receivedOn),
}));

// ---------------------------------------------------------------------------
// Teaching
// ---------------------------------------------------------------------------
export const sermons = pgTable('sermons', {
  id: serial('id').primaryKey(),
  title: jsonb('title').$type<I18n>().notNull().default({}),
  summary: jsonb('summary').$type<I18n>().notNull().default({}),
  speaker: varchar('speaker', { length: 190 }),
  preachedOn: date('preached_on').notNull(),
  scriptureReference: varchar('scripture_reference', { length: 190 }),
  language: varchar('language', { length: 8 }).notNull().default('en'),
  audioPath: text('audio_path'),
  videoUrl: text('video_url'),
  durationSeconds: integer('duration_seconds'),
  isPublished: boolean('is_published').notNull().default(false),
  ...timestamps,
}, (t) => ({
  preachedIdx: index('sermons_preached_idx').on(t.preachedOn),
  publishedIdx: index('sermons_published_idx').on(t.isPublished),
}));

export const conferences = pgTable('conferences', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  venue: varchar('venue', { length: 190 }),
  capacity: integer('capacity'),
  feeAmountMinor: bigint('fee_amount_minor', { mode: 'number' }),
  registrationOpen: boolean('registration_open').notNull().default(true),
  ...timestamps,
}, (t) => ({ startsIdx: index('conferences_starts_idx').on(t.startsOn) }));

export const conferenceRegistrants = pgTable('conference_registrants', {
  id: serial('id').primaryKey(),
  conferenceId: integer('conference_id').notNull().references(() => conferences.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  // Role at the event: attendee (default, pays fee), guest (free), speaker,
  // singer, musician, free (free addition), or other (label in roleNote).
  role: varchar('role', { length: 20 }).notNull().default('attendee'),
  roleNote: varchar('role_note', { length: 120 }),
  registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  unique: uniqueIndex('conference_registrants_unique').on(t.conferenceId, t.personId),
  personIdx: index('conference_registrants_person_idx').on(t.personId),
}));

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------
export const messageCampaigns = pgTable('message_campaigns', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 190 }).notNull(),
  channel: campaignChannel('channel').notNull().default('email'),
  subject: jsonb('subject').$type<I18n>().notNull().default({}),
  body: jsonb('body').$type<I18n>().notNull().default({}),
  status: campaignStatus('status').notNull().default('draft'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => ({ statusIdx: index('message_campaigns_status_idx').on(t.status) }));

/**
 * Reusable, branded message templates (#20b). Additive: a template is saved
 * subject+body copy (bilingual JSONB, same shape as a campaign) plus optional
 * branded header/footer copy the church can reuse across campaigns. Picking a
 * template on the compose screen prefills a new campaign — templates are never
 * sent directly, so this changes no send path. Soft-deleted like other content.
 */
export const messageTemplates = pgTable('message_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 190 }).notNull(),
  channel: campaignChannel('channel').notNull().default('email'),
  subject: jsonb('subject').$type<I18n>().notNull().default({}),
  header: jsonb('header').$type<I18n>().notNull().default({}), // branded greeting/intro
  body: jsonb('body').$type<I18n>().notNull().default({}),
  footer: jsonb('footer').$type<I18n>().notNull().default({}), // branded signature/sign-off
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => ({ activeIdx: index('message_templates_active_idx').on(t.isActive) }));

export const messageRecipients = pgTable('message_recipients', {
  id: serial('id').primaryKey(),
  messageCampaignId: integer('message_campaign_id').notNull().references(() => messageCampaigns.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  status: recipientStatus('status').notNull().default('pending'),
}, (t) => ({
  unique: uniqueIndex('message_recipients_unique').on(t.messageCampaignId, t.personId),
  statusIdx: index('message_recipients_status_idx').on(t.status),
}));

// ---------------------------------------------------------------------------
// Activity log (audit trail)
// ---------------------------------------------------------------------------
export const activityLog = pgTable('activity_log', {
  id: serial('id').primaryKey(),
  causerId: integer('causer_id').references(() => users.id, { onDelete: 'set null' }),
  event: activityEvent('event').notNull(),
  subjectType: varchar('subject_type', { length: 120 }).notNull(),
  subjectId: integer('subject_id'),
  description: text('description'),
  properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ createdIdx: index('activity_log_created_idx').on(t.createdAt) }));

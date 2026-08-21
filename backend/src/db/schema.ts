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
  timestamp, date, jsonb, uuid, uniqueIndex, index, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Schedule } from '../modules/scheduling/schedule.js';

export type I18n = Record<string, string>;

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
  // AI compose assistant. Provider is Anthropic (Claude) or Azure OpenAI.
  aiProvider?: 'anthropic' | 'azure';
  aiApiKey?: string;   // Anthropic key
  aiModel?: string;    // Anthropic model, or the chosen Azure OpenAI model label
  // Azure OpenAI (church's own Azure resource).
  azureOpenaiEndpoint?: string;   // https://<resource>.openai.azure.com
  azureOpenaiKey?: string;        // secret
  azureOpenaiDeployment?: string; // deployment name (defaults to aiModel)
  azureOpenaiApiVersion?: string; // defaults to a recent stable version
  // Optional Azure Maps key for higher-quality address autocomplete. When unset,
  // the app falls back to the free Photon (OpenStreetMap) service. No AI involved.
  azureMapsKey?: string;
};

/**
 * Per-church email presentation (NON-secret). Drives the professional branded
 * email layout — reply-to, website, social links, sign-off, and the contact
 * footer. Returned by the public GET /settings so the SPA can preview emails
 * and brand consistently. No secrets here (those live in `messaging`).
 */
export type EmailSettings = {
  replyTo?: string;            // reply-to address; falls back to org.email
  website?: string;            // church website URL, shown in the footer
  signature?: I18n;            // sign-off line(s), e.g. "Blessings, Pastor …"
  social?: { facebook?: string; instagram?: string; youtube?: string };
  showContactFooter?: boolean; // include address/phone/website footer (default true)
  buttonColor?: string;        // CTA button colour; falls back to brandColor
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
export const automationType = pgEnum('automation_type', ['birthday', 'join_anniversary', 'first_visit_anniversary', 'welcome', 'absence_followup']);
export const automationMode = pgEnum('automation_mode', ['auto', 'manual']);

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
  // Primary brand colour (hex, e.g. #7c3aed). Drives the app accent, branded
  // email templates, the public check-in form, and export/print headers. Null =
  // fall back to the built-in palette.
  brandColor: varchar('brand_color', { length: 9 }),
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
  // Professional email presentation (non-secret): reply-to, website, social,
  // sign-off, footer toggle. Drives the branded email layout + Settings preview.
  emailSettings: jsonb('email_settings').$type<EmailSettings>().notNull().default({}),
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
  // Failed /reset guesses against this code; the code is invalidated after a few
  // so a 6-digit code can't be brute-forced within its TTL.
  attempts: integer('attempts').notNull().default(0),
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
  // Optional middle / father's name — a natural disambiguator for common
  // surnames (Arabic full names are First Father Last). Woven into displayName.
  middleName: jsonb('middle_name').$type<I18n>().notNull().default({}),
  // Optional nickname / preferred name (e.g. "Sam" for Samy). Shown under the
  // full name; helps staff recognise people by what they're actually called.
  nickName: jsonb('nick_name').$type<I18n>().notNull().default({}),
  familyName: jsonb('family_name').$type<I18n>().notNull().default({}),
  householdId: integer('household_id').references(() => households.id, { onDelete: 'set null' }),
  // Optional per-person home address. When any line is set it's the person's own
  // address; when blank they inherit their household's address in displays.
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: varchar('city', { length: 120 }),
  region: varchar('region', { length: 120 }),
  postalCode: varchar('postal_code', { length: 20 }),
  country: varchar('country', { length: 120 }),
  membershipStatus: membershipStatus('membership_status').notNull().default('visitor'),
  email: varchar('email', { length: 190 }),
  mobile: varchar('mobile', { length: 40 }),
  preferredLanguage: varchar('preferred_language', { length: 8 }).notNull().default('en'),
  dateOfBirth: date('date_of_birth'),
  // When this person joined the church (for membership-anniversary celebrations).
  // First-visit is derived from the earliest attendance record.
  joinedOn: date('joined_on'),
  // Extra fields captured by admin-built check-in forms (Phase 3) — keyed by the
  // form field's key. Kept out of first-class columns so forms stay flexible.
  customFields: jsonb('custom_fields').$type<Record<string, string>>().notNull().default({}),
  photoPath: text('photo_path'),
  qrToken: uuid('qr_token').notNull().defaultRandom(),
  // Messaging consent (opt-out per channel; lawful sending suppresses these).
  emailOptOut: boolean('email_opt_out').notNull().default(false),
  smsOptOut: boolean('sms_opt_out').notNull().default(false),
  whatsappOptOut: boolean('whatsapp_opt_out').notNull().default(false),
  unsubToken: uuid('unsub_token').notNull().defaultRandom(), // one-click email unsubscribe
  // Self-registration (public QR): people who added themselves. selfRegistered
  // marks the origin permanently; reviewedAt is null until a staff member vets
  // them (the "flag for review" queue). householdRole is a free relationship
  // label captured at self-registration (e.g. wife/son) for staff context.
  selfRegistered: boolean('self_registered').notNull().default(false),
  householdRole: varchar('household_role', { length: 20 }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  // Archived people are kept for the record but excluded from every active use —
  // lists, pickers, ministry rosters, messaging audiences — until un-archived.
  // Distinct from deletedAt (soft delete) and from isActive (a softer flag).
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // Gifts / skills / interests (Tier D) — free tags used to match & recruit
  // people into ministries ("plays guitar", "good with kids", "speaks Arabic").
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  householdIdx: index('people_household_idx').on(t.householdId),
  statusIdx: index('people_status_idx').on(t.membershipStatus),
  emailIdx: index('people_email_idx').on(t.email),
  mobileIdx: index('people_mobile_idx').on(t.mobile),
  qrUnique: uniqueIndex('people_qr_unique').on(t.qrToken),
  reviewIdx: index('people_review_idx').on(t.selfRegistered, t.reviewedAt),
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
  // Live-stream link for this ministry. 'manual' = a fixed URL; 'youtube' = a
  // channel handle/id whose /live permalink always resolves to the current
  // stream (no API needed). Used to auto-fill a "Watch live" link into messages.
  streaming: jsonb('streaming').$type<{ mode: 'manual' | 'youtube'; url?: string; youtube?: string }>(),
  // Self-referential parent: a ministry with a parent is a sub-ministry; one
  // with children acts as a group. onDelete set null so removing a parent just
  // ungroups its children (and soft-delete means it rarely fires anyway).
  parentId: integer('parent_id').references((): AnyPgColumn => serviceTypes.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  // --- Ministry structure (Tier A/C) ---------------------------------------
  // 'ministry' = a serving team/area; 'group' = a small/home/cell group. Same
  // table so attendance, rosters, and streaming are shared. Varchar (not enum)
  // keeps additions migration-free.
  kind: varchar('kind', { length: 20 }).notNull().default('ministry'),
  // Free-ish category label (worship, children, youth, hospitality, prayer…).
  category: varchar('category', { length: 40 }),
  // The person who leads/coordinates this ministry (for contact + accountability).
  leaderId: integer('leader_id').references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
  contactEmail: varchar('contact_email', { length: 190 }),
  // Where it meets (room, or a group's host home) + when (kept simple + free).
  location: varchar('location', { length: 190 }),
  meetingDay: varchar('meeting_day', { length: 20 }),
  meetingTime: varchar('meeting_time', { length: 20 }),
  // Optional cap on team size + whether people may self-sign-up via a public link.
  capacity: integer('capacity'),
  openToSignup: boolean('open_to_signup').notNull().default(false),
  // Unguessable token for the public "join this ministry" link/QR.
  publicToken: uuid('public_token').notNull().defaultRandom(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  parentIdx: index('service_types_parent_idx').on(t.parentId),
  leaderIdx: index('service_types_leader_idx').on(t.leaderId),
  publicTokenIdx: uniqueIndex('service_types_public_token_idx').on(t.publicToken),
}));

// Ministry roster membership. Now carries a role WITHIN the ministry (leader/
// coordinator/volunteer/member), an active/paused status, and when they started
// serving (for milestones). Varchar roles keep it flexible + migration-free.
export const personServiceType = pgTable('person_service_type', {
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  serviceTypeId: integer('service_type_id').notNull().references(() => serviceTypes.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull().default('member'), // leader|coordinator|volunteer|member
  status: varchar('status', { length: 20 }).notNull().default('active'), // active|paused
  servingSince: date('serving_since'),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  pk: uniqueIndex('person_service_type_pk').on(t.personId, t.serviceTypeId),
  serviceIdx: index('person_service_type_service_idx').on(t.serviceTypeId),
}));

// Serving rota (Tier B): who serves in a ministry on a given date/service, in
// what role, and whether they've confirmed. Reused by the rota builder + the
// reminder worker. serveDate OR attendanceEventId anchors the occasion.
export const servingAssignments = pgTable('serving_assignments', {
  id: serial('id').primaryKey(),
  serviceTypeId: integer('service_type_id').notNull().references(() => serviceTypes.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  attendanceEventId: integer('attendance_event_id').references(() => attendanceEvents.id, { onDelete: 'set null' }),
  serveDate: date('serve_date').notNull(),
  role: varchar('role', { length: 60 }), // ministry-specific: Vocals, Usher, Teacher…
  status: varchar('status', { length: 20 }).notNull().default('invited'), // invited|confirmed|declined
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({
  serviceDateIdx: index('serving_assignments_service_date_idx').on(t.serviceTypeId, t.serveDate),
  personIdx: index('serving_assignments_person_idx').on(t.personId),
  dateIdx: index('serving_assignments_date_idx').on(t.serveDate),
}));

// Safeguarding clearances (Tier C): background checks / training per person,
// with issue + expiry dates. Surfaced as a warning when assigning someone to a
// children/youth ministry without a valid, unexpired clearance.
export const personClearances = pgTable('person_clearances', {
  id: serial('id').primaryKey(),
  personId: integer('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 40 }).notNull(), // background_check|safeguarding_training|other
  status: varchar('status', { length: 20 }).notNull().default('valid'), // valid|pending|expired
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  notes: text('notes'),
  ...timestamps,
}, (t) => ({ personIdx: index('person_clearances_person_idx').on(t.personId) }));

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

// Admin-editable public intake/connect forms (Phase 3). Each has an unguessable
// publicToken for a shareable link/QR. `fields` is an ordered array of field defs
// (see FormField below). Standard field keys map to people columns; anything else
// is stored in people.customFields.
export type FormField = {
  key: string;
  label: I18n;
  type: 'text' | 'tel' | 'email' | 'date' | 'select' | 'checkbox';
  required: boolean;
  forWhom: 'primary' | 'all'; // primary = the main registrant; all = every person added
  options?: string[];         // for select
};

export const checkinForms = pgTable('checkin_forms', {
  id: serial('id').primaryKey(),
  name: jsonb('name').$type<I18n>().notNull().default({}),
  intro: jsonb('intro').$type<I18n>().notNull().default({}),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  showFamily: boolean('show_family').notNull().default(true),
  showConsent: boolean('show_consent').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  active: boolean('active').notNull().default(true),
  publicToken: uuid('public_token').notNull().defaultRandom(),
  ...timestamps,
}, (t) => ({
  publicTokenIdx: uniqueIndex('checkin_forms_public_token_idx').on(t.publicToken),
}));

// Church vendors / suppliers / service providers (electrician, worship gear,
// caterer, etc.). Simple contact directory managed by admins.
export const vendors = pgTable('vendors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 190 }).notNull(),
  title: varchar('title', { length: 120 }),     // role / occupation
  category: varchar('category', { length: 120 }),
  email: varchar('email', { length: 190 }),
  phone: varchar('phone', { length: 40 }),
  mobile: varchar('mobile', { length: 40 }),
  website: varchar('website', { length: 190 }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({ nameIdx: index('vendors_name_idx').on(t.name) }));

// Automated messages (Phase 5). One row per automation type. Each is toggled on/
// off and set to auto (worker sends) or manual (staff triggers) by an Admin.
// config holds per-type knobs (e.g. { absenceWeeks: 4 }). lastRunOn guards
// once-per-day/week sends. templateId + channel decide what/how to send.
export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  type: automationType('type').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  mode: automationMode('mode').notNull().default('auto'),
  channel: campaignChannel('channel').notNull().default('email'),
  templateId: integer('template_id').references((): AnyPgColumn => messageTemplates.id, { onDelete: 'set null' }),
  config: jsonb('config').$type<Record<string, number | string>>().notNull().default({}),
  // Reusable schedule (once/recurring, frequency, time-of-day, days, start/end),
  // evaluated in the church timezone. Null = legacy default (see scheduling module).
  schedule: jsonb('schedule').$type<Schedule>(),
  lastRunOn: date('last_run_on'),
  ...timestamps,
}, (t) => ({ typeIdx: uniqueIndex('automations_type_idx').on(t.type) }));

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
  // Optional image sent as MMS (SMS) / media (WhatsApp) — a public media URL.
  mediaUrl: text('media_url'),
  // Optional call-to-action button (email): localized label + a link URL.
  ctaLabel: jsonb('cta_label').$type<I18n>(),
  ctaUrl: text('cta_url'),
  // Who receives it, resolved against opted-in people on the channel at SEND time:
  //  - 'all'        → everyone opted-in (null is the legacy equivalent)
  //  - 'people'     → an explicit person list (select-all / unchecked in composer)
  //  - 'ministries' → the current roster of the chosen ministries/groups (dynamic)
  //  - 'segment'    → people matching saved filters (status/age/birthday/… — dynamic)
  // Dynamic modes re-resolve each recurring occurrence, so a weekly send to a
  // ministry always hits its current members.
  audience: jsonb('audience').$type<{
    mode: 'all' | 'people' | 'ministries' | 'segment';
    personIds?: number[];
    ministryIds?: number[];
    segment?: Record<string, string | number>;
  }>(),
  // Recurring schedule (reuses the shared Schedule model). When set, the worker
  // re-sends each due occurrence instead of marking the campaign done.
  schedule: jsonb('schedule').$type<Schedule>(),
  lastRunOn: date('last_run_on'),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => ({ statusIdx: index('message_campaigns_status_idx').on(t.status) }));

// Uploaded media (images for MMS/WhatsApp) stored in the DB and served at a
// public URL (Twilio fetches it). base64 payload — MMS caps around 5 MB.
export const media = pgTable('media', {
  id: serial('id').primaryKey(),
  token: uuid('token').notNull().defaultRandom(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  filename: varchar('filename', { length: 190 }),
  data: text('data').notNull(),
  ...timestamps,
}, (t) => ({ tokenIdx: uniqueIndex('media_token_idx').on(t.token) }));

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

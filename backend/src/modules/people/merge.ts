import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  people, peopleMerges, attendanceRecords, personServiceType, conferenceRegistrants,
  servingAssignments, personClearances, careItems, smsMessages, contributions,
  messageRecipients, users,
} from '../../db/schema.js';
import { badRequest, notFound } from '../../http/errors.js';

/**
 * Merge two duplicate people into one, REVERSIBLY.
 *
 * - The survivor (primary) keeps its own data; only EMPTY fields are filled from
 *   the duplicate (secondary) — we never overwrite existing values.
 * - Every linked row (attendance, giving, ministries, messages, care, …) moves
 *   from the duplicate to the survivor, EXCEPT rows that would collide on a unique
 *   constraint (e.g. both were checked in to the same gathering) — those stay on
 *   the duplicate so nothing is lost.
 * - The duplicate is SOFT-deleted (deletedAt + mergedIntoId), never hard-deleted.
 * - A `people_merges` snapshot records the survivor's overwritten fields and the
 *   ids of every moved row, so `undoMerge` can put everything back exactly.
 */

type Person = typeof people.$inferSelect;

// Survivor fields filled from the duplicate ONLY when the survivor's is empty.
const FILL_TEXT = ['email', 'mobile', 'dateOfBirth', 'joinedOn', 'firstVisitOn', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'country', 'photoPath', 'notes', 'householdRole', 'followUpStage', 'baptizedOn', 'baptismType'] as const;
const FILL_I18N = ['middleName', 'nickName'] as const;

const emptyText = (v: unknown) => v == null || v === '';
const emptyI18n = (v: any) => !v || typeof v !== 'object' || Object.keys(v).length === 0;

/** Compute the survivor fields that WOULD be filled from the duplicate (new values). */
function fieldsToFill(primary: Person, secondary: Person): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FILL_TEXT) if (emptyText((primary as any)[f]) && !emptyText((secondary as any)[f])) out[f] = (secondary as any)[f];
  for (const f of FILL_I18N) if (emptyI18n((primary as any)[f]) && !emptyI18n((secondary as any)[f])) out[f] = (secondary as any)[f];
  if (primary.householdId == null && secondary.householdId != null) out.householdId = secondary.householdId;
  if (!primary.baptized && secondary.baptized) out.baptized = true;
  if ((!primary.skills || primary.skills.length === 0) && secondary.skills && secondary.skills.length) out.skills = secondary.skills;
  const mergedCustom = { ...(secondary.customFields ?? {}), ...(primary.customFields ?? {}) };
  if (JSON.stringify(mergedCustom) !== JSON.stringify(primary.customFields ?? {})) out.customFields = mergedCustom;
  return out;
}

async function loadPair(primaryId: number, secondaryId: number): Promise<{ primary: Person; secondary: Person }> {
  if (primaryId === secondaryId) throw badRequest('Cannot merge a person with themselves.');
  const [primary] = await db.select().from(people).where(and(eq(people.id, primaryId), isNull(people.deletedAt))).limit(1);
  const [secondary] = await db.select().from(people).where(and(eq(people.id, secondaryId), isNull(people.deletedAt))).limit(1);
  if (!primary || !secondary) throw notFound('One of the records no longer exists.');
  return { primary, secondary };
}

const countFor = async (tbl: any, personId: number): Promise<number> => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tbl).where(eq(tbl.personId, personId));
  return r?.n ?? 0;
};

const nameOf = (p: Person) => `${(p.givenName as any)?.en ?? (p.givenName as any)?.ar ?? ''} ${(p.familyName as any)?.en ?? (p.familyName as any)?.ar ?? ''}`.trim();

/** Preview: what the merge would fill + how many linked rows would move. No writes. */
export async function mergePreview(primaryId: number, secondaryId: number) {
  const { primary, secondary } = await loadPair(primaryId, secondaryId);
  const fill = fieldsToFill(primary, secondary);
  const filledFields = Object.keys(fill).map((f) => ({ field: f, value: fill[f] }));
  const counts = {
    attendance: await countFor(attendanceRecords, secondaryId),
    ministries: await countFor(personServiceType, secondaryId),
    serving: await countFor(servingAssignments, secondaryId),
    clearances: await countFor(personClearances, secondaryId),
    giving: await countFor(contributions, secondaryId),
    messages: await countFor(messageRecipients, secondaryId),
    care: await countFor(careItems, secondaryId),
    sms: await countFor(smsMessages, secondaryId),
    conference: await countFor(conferenceRegistrants, secondaryId),
  };
  return {
    primary: { id: primary.id, name: nameOf(primary) },
    secondary: { id: secondary.id, name: nameOf(secondary) },
    filledFields,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

export async function mergePeople(primaryId: number, secondaryId: number, userId: number | null): Promise<{ mergeId: number }> {
  const { primary, secondary } = await loadPair(primaryId, secondaryId);
  const fill = fieldsToFill(primary, secondary);
  const oldValues: Record<string, unknown> = {};
  for (const f of Object.keys(fill)) oldValues[f] = (primary as any)[f];
  const moved: Record<string, number[]> = {};

  const mergeId = await db.transaction(async (tx) => {
    // Plain tables: move every row from secondary to primary.
    const moveAll = async (tbl: any, key: string) => {
      const rows = await tx.update(tbl).set({ personId: primaryId }).where(eq(tbl.personId, secondaryId)).returning({ id: tbl.id });
      moved[key] = rows.map((r: any) => r.id);
    };
    await moveAll(servingAssignments, 'serving_assignments');
    await moveAll(personClearances, 'person_clearances');
    await moveAll(careItems, 'care_items');
    await moveAll(smsMessages, 'sms_messages');
    await moveAll(contributions, 'contributions');
    await moveAll(messageRecipients, 'message_recipients');
    // A login account pointing at the duplicate re-points to the survivor.
    const movedUsers = await tx.update(users).set({ personId: primaryId }).where(eq(users.personId, secondaryId)).returning({ id: users.id });
    moved['users'] = movedUsers.map((r) => r.id);

    // Unique-constrained tables: move only the rows that don't collide; leave the
    // rest on the (now soft-deleted) duplicate so undo can restore them.
    const attRows = await tx.update(attendanceRecords).set({ personId: primaryId })
      .where(and(eq(attendanceRecords.personId, secondaryId),
        sql`NOT EXISTS (SELECT 1 FROM ${attendanceRecords} a2 WHERE a2.attendance_event_id = ${attendanceRecords.attendanceEventId} AND a2.person_id = ${primaryId})`))
      .returning({ id: attendanceRecords.id });
    moved['attendance_records'] = attRows.map((r) => r.id);

    const confRows = await tx.update(conferenceRegistrants).set({ personId: primaryId })
      .where(and(eq(conferenceRegistrants.personId, secondaryId),
        sql`NOT EXISTS (SELECT 1 FROM ${conferenceRegistrants} c2 WHERE c2.conference_id = ${conferenceRegistrants.conferenceId} AND c2.person_id = ${primaryId})`))
      .returning({ id: conferenceRegistrants.id });
    moved['conference_registrants'] = confRows.map((r) => r.id);

    // person_service_type has no id (composite pk) — track by service_type_id.
    const pstRows = await tx.update(personServiceType).set({ personId: primaryId })
      .where(and(eq(personServiceType.personId, secondaryId),
        sql`NOT EXISTS (SELECT 1 FROM ${personServiceType} p2 WHERE p2.service_type_id = ${personServiceType.serviceTypeId} AND p2.person_id = ${primaryId})`))
      .returning({ sid: personServiceType.serviceTypeId });
    moved['person_service_type'] = pstRows.map((r) => r.sid);

    // Fill the survivor's empty fields, then soft-delete the duplicate.
    if (Object.keys(fill).length) await tx.update(people).set({ ...fill, updatedAt: new Date() }).where(eq(people.id, primaryId));
    await tx.update(people).set({ deletedAt: new Date(), isActive: false, mergedIntoId: primaryId, updatedAt: new Date() }).where(eq(people.id, secondaryId));

    const [rec] = await tx.insert(peopleMerges).values({
      primaryId, secondaryId, snapshot: { filled: oldValues, moved }, createdByUserId: userId ?? null,
    }).returning({ id: peopleMerges.id });
    return rec!.id;
  });
  return { mergeId };
}

export async function undoMerge(mergeId: number): Promise<void> {
  const [m] = await db.select().from(peopleMerges).where(eq(peopleMerges.id, mergeId)).limit(1);
  if (!m) throw notFound('Merge not found.');
  if (m.undoneAt) throw badRequest('This merge has already been undone.');
  const { primaryId, secondaryId, snapshot } = m;
  const moved = snapshot.moved ?? {};

  await db.transaction(async (tx) => {
    const back = async (tbl: any, key: string) => {
      const ids = moved[key] ?? [];
      if (ids.length) await tx.update(tbl).set({ personId: secondaryId }).where(inArray(tbl.id, ids));
    };
    await back(servingAssignments, 'serving_assignments');
    await back(personClearances, 'person_clearances');
    await back(careItems, 'care_items');
    await back(smsMessages, 'sms_messages');
    await back(contributions, 'contributions');
    await back(messageRecipients, 'message_recipients');
    await back(attendanceRecords, 'attendance_records');
    await back(conferenceRegistrants, 'conference_registrants');
    const userIds = moved['users'] ?? [];
    if (userIds.length) await tx.update(users).set({ personId: secondaryId }).where(inArray(users.id, userIds));
    const sids = moved['person_service_type'] ?? [];
    if (sids.length) await tx.update(personServiceType).set({ personId: secondaryId }).where(and(eq(personServiceType.personId, primaryId), inArray(personServiceType.serviceTypeId, sids)));

    // Restore the survivor's overwritten fields, then un-delete the duplicate.
    const filled = snapshot.filled ?? {};
    if (Object.keys(filled).length) await tx.update(people).set({ ...filled, updatedAt: new Date() }).where(eq(people.id, primaryId));
    await tx.update(people).set({ deletedAt: null, isActive: true, mergedIntoId: null, updatedAt: new Date() }).where(eq(people.id, secondaryId));
    await tx.update(peopleMerges).set({ undoneAt: new Date() }).where(eq(peopleMerges.id, mergeId));
  });
}

/** Recent merges that can still be undone (newest first). */
export async function recentMerges(limit = 10) {
  const rows = await db.select().from(peopleMerges).where(isNull(peopleMerges.undoneAt)).orderBy(sql`${peopleMerges.createdAt} DESC`).limit(limit);
  const withNames = await Promise.all(rows.map(async (r) => {
    const [p] = await db.select({ g: people.givenName, f: people.familyName }).from(people).where(eq(people.id, r.primaryId)).limit(1);
    const [s] = await db.select({ g: people.givenName, f: people.familyName }).from(people).where(eq(people.id, r.secondaryId)).limit(1);
    const nm = (x: any) => x ? `${x.g?.en ?? x.g?.ar ?? ''} ${x.f?.en ?? x.f?.ar ?? ''}`.trim() : '—';
    return { id: r.id, primaryId: r.primaryId, secondaryId: r.secondaryId, primaryName: nm(p), secondaryName: nm(s), createdAt: r.createdAt };
  }));
  return withNames;
}

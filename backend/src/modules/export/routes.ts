import { Router } from 'express';
import ExcelJS from 'exceljs';
import { desc, eq, isNull, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households, contributions, funds, attendanceEvents, attendanceRecords, serviceTypes } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { currentOrg } from '../settings/routes.js';
import { peopleListQuery, peopleFilters } from '../people/filters.js';
import { familyListQuery, familyWhere, memberCountExpr, childCountExpr } from '../families/filters.js';
import { and } from 'drizzle-orm';

/**
 * Data export (CSV + branded XLSX). The frontend also offers a branded
 * print-to-PDF built client-side; this module covers the file downloads. XLSX
 * gets a church-branded title block (name + generated timestamp + logo).
 */
export const exportRouter = Router();
exportRouter.use(authenticate);

type Row = (string | number)[];
const en = (v: Record<string, string> | null | undefined) => (v ? v.en ?? v.ar ?? Object.values(v)[0] ?? '' : '');

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res: import('express').Response, filename: string, headers: string[], rows: Row[]): void {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  const body = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8 (Arabic) correctly
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(body);
}

async function sendXlsx(
  res: import('express').Response,
  filename: string,
  title: string,
  headers: string[],
  rows: Row[],
  org: { name?: Record<string, string> | null; logoPath?: string | null; brandColor?: string | null },
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 28) || 'Export');
  const brand = (org.brandColor && /^#([0-9a-fA-F]{6})$/.test(org.brandColor) ? org.brandColor : '#3b3f8c').slice(1);
  const cols = Math.max(headers.length, 1);

  // Branded title block.
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = `${en(org.name) || 'Church'} — ${title}`;
  t.font = { bold: true, size: 14, color: { argb: `FF${brand}` } };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF888888' } };

  // Embed the logo if it's a data URL.
  if (org.logoPath && /^data:image\/(png|jpe?g);base64,/.test(org.logoPath)) {
    try {
      const ext = org.logoPath.includes('image/png') ? 'png' : 'jpeg';
      const b64 = org.logoPath.split(',')[1]!;
      const imgId = wb.addImage({ base64: b64, extension: ext as 'png' | 'jpeg' });
      ws.addImage(imgId, { tl: { col: cols - 1.6, row: 0 }, ext: { width: 90, height: 40 } });
    } catch { /* logo embed is best-effort */ }
  }

  // Header row (row 4).
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brand}` } };
  });
  headerRow.commit();

  rows.forEach((r) => ws.addRow(r));
  headers.forEach((_h, i) => { ws.getColumn(i + 1).width = 22; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

const isXlsx = (req: import('express').Request) => String(req.query.format).toLowerCase() === 'xlsx';

// --- Members -----------------------------------------------------------------
// Honours the same filters as the Members list, so a filtered view exports/prints
// only those people (no filters → everyone).
exportRouter.get('/members', requirePermission('view person'), asyncHandler(async (req, res) => {
  const q = peopleListQuery.parse(req.query);
  const rows = await db
    .select({
      given: people.givenName, family: people.familyName, status: people.membershipStatus,
      email: people.email, mobile: people.mobile, dob: people.dateOfBirth, joined: people.joinedOn,
      household: households.name,
    })
    .from(people)
    .leftJoin(households, eq(households.id, people.householdId))
    .where(and(...peopleFilters(q)))
    .orderBy(desc(people.createdAt));
  const headers = ['First name', 'Last name', 'Status', 'Email', 'Mobile', 'Date of birth', 'Joined', 'Family'];
  const data: Row[] = rows.map((r) => [en(r.given), en(r.family), r.status, r.email ?? '', r.mobile ?? '', r.dob ?? '', r.joined ?? '', en(r.household)]);
  const org = await currentOrg();
  if (isXlsx(req)) return sendXlsx(res, 'members', 'Members', headers, data, org);
  sendCsv(res, 'members', headers, data);
}));

// --- Families ----------------------------------------------------------------
exportRouter.get('/families', requirePermission('view household'), asyncHandler(async (req, res) => {
  const q = familyListQuery.parse(req.query);
  const rows = await db
    .select({ name: households.name, members: memberCountExpr, children: childCountExpr, phone: households.homePhone, city: households.city })
    .from(households)
    .where(familyWhere(q))
    .orderBy(desc(households.createdAt));
  const headers = ['Family', 'Members', 'Children', 'Phone', 'City'];
  const data: Row[] = rows.map((r) => [en(r.name), r.members, r.children, r.phone ?? '', r.city ?? '']);
  const org = await currentOrg();
  if (isXlsx(req)) return sendXlsx(res, 'families', 'Families', headers, data, org);
  sendCsv(res, 'families', headers, data);
}));

// --- Giving ------------------------------------------------------------------
exportRouter.get('/giving', requirePermission('view contribution'), asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      date: contributions.receivedOn, amount: contributions.amountCents, currency: contributions.currency,
      method: contributions.method, fund: funds.name, reference: contributions.reference,
      given: people.givenName, family: people.familyName, household: households.name, anon: contributions.isAnonymous,
    })
    .from(contributions)
    .leftJoin(funds, eq(funds.id, contributions.fundId))
    .leftJoin(people, eq(people.id, contributions.personId))
    .leftJoin(households, eq(households.id, contributions.householdId))
    .where(isNull(contributions.deletedAt))
    .orderBy(desc(contributions.receivedOn));
  const headers = ['Date', 'Amount', 'Currency', 'Fund', 'Method', 'Contributor', 'Reference'];
  const data: Row[] = rows.map((r) => [
    r.date, (Number(r.amount) / 100).toFixed(2), r.currency, en(r.fund), r.method,
    r.anon ? 'Anonymous' : (`${en(r.given)} ${en(r.family)}`.trim() || en(r.household)), r.reference ?? '',
  ]);
  const org = await currentOrg();
  if (isXlsx(req)) return sendXlsx(res, 'giving', 'Giving', headers, data, org);
  sendCsv(res, 'giving', headers, data);
}));

const fmtDate = (d: Date | string | null) => d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '';

// --- Attendance: the sessions list (honours the same list filters) -----------
exportRouter.get('/attendance', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string>;
  const filters = [] as import('drizzle-orm').SQL[];
  if (q.q?.trim()) { const like = `%${q.q.trim().toLowerCase()}%`; filters.push(sql`(lower(coalesce(${attendanceEvents.title}->>'en','')) LIKE ${like} OR lower(coalesce(${attendanceEvents.title}->>'ar','')) LIKE ${like})`); }
  if (q.year) filters.push(sql`extract(year from ${attendanceEvents.startsAt}) = ${Number(q.year)}`);
  if (q.month) filters.push(sql`extract(month from ${attendanceEvents.startsAt}) = ${Number(q.month)}`);
  if (q.dow !== undefined && q.dow !== '') filters.push(sql`extract(dow from ${attendanceEvents.startsAt}) = ${Number(q.dow)}`);
  if (q.serviceTypeId) filters.push(eq(attendanceEvents.serviceTypeId, Number(q.serviceTypeId)));
  if (q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) filters.push(gte(attendanceEvents.startsAt, d)); }
  if (q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); filters.push(lte(attendanceEvents.startsAt, d)); } }
  const countExpr = sql<number>`(SELECT count(*)::int FROM ${attendanceRecords} r WHERE r.attendance_event_id = attendance_events.id)`;
  const rows = await db
    .select({ startsAt: attendanceEvents.startsAt, title: attendanceEvents.title, service: serviceTypes.name, count: countExpr })
    .from(attendanceEvents)
    .leftJoin(serviceTypes, eq(serviceTypes.id, attendanceEvents.serviceTypeId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(attendanceEvents.startsAt));
  const headers = ['Date', 'Gathering', 'Service', 'Attendance'];
  const data: Row[] = rows.map((r) => [fmtDate(r.startsAt), en(r.title), en(r.service), r.count ?? 0]);
  const org = await currentOrg();
  if (isXlsx(req)) return sendXlsx(res, 'attendance', 'Attendance — sessions', headers, data, org);
  sendCsv(res, 'attendance', headers, data);
}));

// --- Attendance: one event's attendee list (?eventId=) -----------------------
exportRouter.get('/attendance-event', requirePermission('view attendance'), asyncHandler(async (req, res) => {
  const qp = req.query as Record<string, string>;
  const eventId = Number(qp.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) return sendCsv(res, 'attendance', ['Name'], []);
  const [ev] = await db.select({ title: attendanceEvents.title, startsAt: attendanceEvents.startsAt }).from(attendanceEvents).where(eq(attendanceEvents.id, eventId)).limit(1);
  // Honour the same filters the event page shows, so the export matches the view.
  const filters = [eq(attendanceRecords.attendanceEventId, eventId)] as import('drizzle-orm').SQL[];
  const statuses = (qp.statuses ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (statuses.length) filters.push(sql`${people.membershipStatus} IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`);
  const ages = (qp.ageGroups ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ages.length) {
    const parts = ages.map((g) => g === 'child'
      ? sql`(${people.dateOfBirth} IS NOT NULL AND extract(year from age(${people.dateOfBirth})) < 13)`
      : g === 'youth' ? sql`extract(year from age(${people.dateOfBirth})) BETWEEN 13 AND 17`
        : sql`extract(year from age(${people.dateOfBirth})) >= 18`);
    filters.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (qp.q?.trim()) { const like = `%${qp.q.trim().toLowerCase()}%`; filters.push(sql`(lower(coalesce(${people.givenName}->>'en','')||' '||coalesce(${people.familyName}->>'en','')) LIKE ${like} OR lower(coalesce(${people.givenName}->>'ar','')||' '||coalesce(${people.familyName}->>'ar','')) LIKE ${like})`); }
  if (qp.newOnly === 'true') filters.push(sql`(${people.selfRegistered} = true AND ${people.reviewedAt} IS NULL)`);
  const rows = await db
    .select({ given: people.givenName, family: people.familyName, status: people.membershipStatus, email: people.email, mobile: people.mobile, checkedInAt: attendanceRecords.checkedInAt })
    .from(attendanceRecords)
    .innerJoin(people, eq(people.id, attendanceRecords.personId))
    .where(and(...filters))
    .orderBy(desc(attendanceRecords.checkedInAt));
  const headers = ['#', 'Name', 'Status', 'Checked in', 'Email', 'Mobile'];
  const data: Row[] = rows.map((r, i) => [i + 1, `${en(r.given)} ${en(r.family)}`.trim(), r.status, fmtDate(r.checkedInAt), r.email ?? '', r.mobile ?? '']);
  const org = await currentOrg();
  const title = `${en(ev?.title) || 'Attendance'} — ${fmtDate(ev?.startsAt ?? null)}`;
  if (isXlsx(req)) return sendXlsx(res, 'attendance-event', title, headers, data, org);
  sendCsv(res, 'attendance-event', headers, data);
}));

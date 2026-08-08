import { Router } from 'express';
import ExcelJS from 'exceljs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households, contributions, funds } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { currentOrg } from '../settings/routes.js';

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
exportRouter.get('/members', requirePermission('view person'), asyncHandler(async (req, res) => {
  const rows = await db
    .select({
      given: people.givenName, family: people.familyName, status: people.membershipStatus,
      email: people.email, mobile: people.mobile, dob: people.dateOfBirth, joined: people.joinedOn,
      household: households.name,
    })
    .from(people)
    .leftJoin(households, eq(households.id, people.householdId))
    .where(isNull(people.deletedAt))
    .orderBy(desc(people.createdAt));
  const headers = ['First name', 'Last name', 'Status', 'Email', 'Mobile', 'Date of birth', 'Joined', 'Family'];
  const data: Row[] = rows.map((r) => [en(r.given), en(r.family), r.status, r.email ?? '', r.mobile ?? '', r.dob ?? '', r.joined ?? '', en(r.household)]);
  const org = await currentOrg();
  if (isXlsx(req)) return sendXlsx(res, 'members', 'Members', headers, data, org);
  sendCsv(res, 'members', headers, data);
}));

// --- Families ----------------------------------------------------------------
exportRouter.get('/families', requirePermission('view household'), asyncHandler(async (req, res) => {
  const memberCount = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.is_active = true)`;
  const childCount = sql<number>`(SELECT count(*)::int FROM ${people} p WHERE p.household_id = ${households.id} AND p.deleted_at IS NULL AND p.date_of_birth IS NOT NULL AND extract(year from age(p.date_of_birth)) < 13)`;
  const rows = await db
    .select({ name: households.name, members: memberCount, children: childCount, phone: households.homePhone, city: households.city })
    .from(households)
    .where(isNull(households.deletedAt))
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

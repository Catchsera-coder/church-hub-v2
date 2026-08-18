import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, households } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

/**
 * Bulk import of members from an Excel/CSV file. Flow: download a template →
 * fill it → upload → the server maps columns, validates each row and FLAGS what's
 * missing/invalid → the client imports only the good rows.
 */
export const importRouter = Router();
importRouter.use(authenticate);

const COLUMNS = [
  { key: 'givenName', header: 'First name' },
  { key: 'familyName', header: 'Last name' },
  { key: 'email', header: 'Email' },
  { key: 'mobile', header: 'Mobile' },
  { key: 'dateOfBirth', header: 'Date of birth (YYYY-MM-DD)' },
  { key: 'joinedOn', header: 'Joined (YYYY-MM-DD)' },
  { key: 'household', header: 'Family' },
  { key: 'membershipStatus', header: 'Status (visitor/regular/member)' },
];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
const ALIASES: Record<string, string> = {
  firstname: 'givenName', first: 'givenName', givenname: 'givenName', given: 'givenName', name: 'givenName',
  lastname: 'familyName', last: 'familyName', familyname: 'familyName', surname: 'familyName',
  email: 'email', emailaddress: 'email',
  mobile: 'mobile', phone: 'mobile', cell: 'mobile', cellphone: 'mobile', mobilephone: 'mobile', phonenumber: 'mobile',
  dob: 'dateOfBirth', dateofbirth: 'dateOfBirth', dateofbirthyyyymmdd: 'dateOfBirth', birthday: 'dateOfBirth', birthdate: 'dateOfBirth',
  joined: 'joinedOn', joinedon: 'joinedOn', joindate: 'joinedOn', joinedyyyymmdd: 'joinedOn', membershipdate: 'joinedOn',
  family: 'household', household: 'household', familygroup: 'household',
  status: 'membershipStatus', membership: 'membershipStatus', membershipstatus: 'membershipStatus', statusvisitorregularmember: 'membershipStatus',
};
const STATUSES = new Set(['visitor', 'regular', 'member', 'inactive']);

function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// GET template (xlsx with the expected headers + one example row).
importRouter.get('/members/template', requirePermission('create person'), asyncHandler(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Members');
  ws.addRow(COLUMNS.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  ws.addRow(['John', 'Doe', 'john@example.com', '+15551234567', '1990-05-20', '2022-01-15', 'Doe Family', 'member']);
  COLUMNS.forEach((_c, i) => { ws.getColumn(i + 1).width = 26; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="members-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// Parse an uploaded file (base64) and return mapped rows + per-row flags.
const previewSchema = z.object({ filename: z.string(), base64: z.string().max(8_000_000) });
importRouter.post('/members/preview', requirePermission('create person'), asyncHandler(async (req, res) => {
  const { filename, base64 } = previewSchema.parse(req.body);
  const buf = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64');

  let headers: string[] = [];
  const dataRows: unknown[][] = [];
  if (/\.csv$/i.test(filename)) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const split = (l: string) => l.match(/(".*?"|[^,]+)(?=,|$)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
    headers = split(lines[0] ?? '');
    for (const l of lines.slice(1)) dataRows.push(split(l));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The file has no sheets.');
    ws.getRow(1).eachCell((c) => headers.push(String(c.value ?? '')));
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals: unknown[] = [];
      for (let c = 1; c <= headers.length; c++) vals.push(row.getCell(c).value);
      if (vals.some((v) => v != null && String(v).trim() !== '')) dataRows.push(vals);
    }
  }

  const map = headers.map((h) => ALIASES[norm(h)] ?? null);
  if (!map.includes('givenName')) throw badRequest('Could not find a "First name" column. Use the template headers.');

  const rows = dataRows.map((cells, i) => {
    const values: Record<string, string> = {};
    map.forEach((key, ci) => { if (key) { const v = cells[ci]; values[key] = v == null ? '' : String(v).trim(); } });
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!values.givenName) errors.push('First name is required');
    if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.push('Invalid email');
    if (values.dateOfBirth) { const d = toDate(values.dateOfBirth); if (!d) warnings.push('Unrecognised date of birth'); else values.dateOfBirth = d; }
    if (values.joinedOn) { const d = toDate(values.joinedOn); if (!d) warnings.push('Unrecognised joined date'); else values.joinedOn = d; }
    if (values.membershipStatus && !STATUSES.has(values.membershipStatus.toLowerCase())) { warnings.push(`Unknown status "${values.membershipStatus}" — will use visitor`); }
    if (!values.email && !values.mobile) warnings.push('No email or phone');
    return { index: i + 2, values, errors, warnings };
  });

  res.json({ data: { rows, summary: { total: rows.length, ok: rows.filter((r) => r.errors.length === 0).length, errors: rows.filter((r) => r.errors.length > 0).length } } });
}));

// Import validated rows.
const importSchema = z.object({ rows: z.array(z.record(z.string())).max(5000) });
importRouter.post('/members', requirePermission('create person'), asyncHandler(async (req, res) => {
  const { rows } = importSchema.parse(req.body);
  const householdCache = new Map<string, number>();
  let created = 0;
  for (const v of rows) {
    const given = (v.givenName ?? '').trim();
    if (!given) continue;
    let householdId: number | null = null;
    const fam = (v.household ?? '').trim();
    if (fam) {
      if (householdCache.has(fam)) householdId = householdCache.get(fam)!;
      else {
        const [existing] = await db.select({ id: households.id }).from(households).where(and(sql`${households.name}->>'en' = ${fam}`, isNull(households.deletedAt))).limit(1);
        if (existing) householdId = existing.id;
        else { const [h] = await db.insert(households).values({ name: { en: fam } }).returning(); householdId = h?.id ?? null; }
        if (householdId) householdCache.set(fam, householdId);
      }
    }
    const status = (v.membershipStatus ?? '').toLowerCase();
    await db.insert(people).values({
      givenName: { en: given },
      familyName: { en: (v.familyName ?? '').trim() },
      email: v.email?.trim() ? v.email.trim().toLowerCase() : null,
      mobile: v.mobile?.trim() || null,
      dateOfBirth: toDate(v.dateOfBirth),
      joinedOn: toDate(v.joinedOn),
      householdId,
      membershipStatus: STATUSES.has(status) ? (status as 'visitor' | 'regular' | 'member' | 'inactive') : 'visitor',
    });
    created++;
  }
  await logActivity(req, 'created', 'person', 0, `import: ${created}`);
  res.json({ data: { created } });
}));

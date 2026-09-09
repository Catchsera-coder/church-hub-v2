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
 *
 * Captures name, contact (email/mobile/home phone), full address, key dates
 * (DOB / joined / first-visit), family, status, and category ('congregation' vs
 * 'contact' — external directory). Imports DEDUPE against existing people by
 * email or mobile so re-imports and overlapping lists never create duplicates.
 */
export const importRouter = Router();
importRouter.use(authenticate);

const COLUMNS = [
  { key: 'givenName', header: 'First name' },
  { key: 'familyName', header: 'Last name' },
  { key: 'email', header: 'Email' },
  { key: 'mobile', header: 'Mobile' },
  { key: 'homePhone', header: 'Home phone' },
  { key: 'addressLine1', header: 'Address line 1' },
  { key: 'city', header: 'City' },
  { key: 'region', header: 'State / Region' },
  { key: 'postalCode', header: 'Postal code' },
  { key: 'country', header: 'Country' },
  { key: 'dateOfBirth', header: 'Date of birth (YYYY-MM-DD)' },
  { key: 'joinedOn', header: 'Joined (YYYY-MM-DD)' },
  { key: 'firstVisitOn', header: 'First visit (YYYY-MM-DD)' },
  { key: 'household', header: 'Family' },
  { key: 'membershipStatus', header: 'Status (visitor/regular/member)' },
  { key: 'category', header: 'Category (congregation/contact)' },
];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
const ALIASES: Record<string, string> = {
  firstname: 'givenName', first: 'givenName', givenname: 'givenName', given: 'givenName', name: 'givenName',
  lastname: 'familyName', last: 'familyName', familyname: 'familyName', surname: 'familyName', householdname: 'familyName',
  email: 'email', emailaddress: 'email',
  mobile: 'mobile', cell: 'mobile', cellphone: 'mobile', mobilephone: 'mobile', mobileno: 'mobile',
  phone: 'mobile', phonenumber: 'mobile',
  homephone: 'homePhone', landline: 'homePhone', housephone: 'homePhone', telephone: 'homePhone',
  address: 'addressLine1', addressline: 'addressLine1', addressline1: 'addressLine1', street: 'addressLine1', streetaddress: 'addressLine1',
  city: 'city', town: 'city',
  state: 'region', stateorprovince: 'region', province: 'region', region: 'region',
  zip: 'postalCode', zipcode: 'postalCode', postalcode: 'postalCode', postcode: 'postalCode',
  country: 'country',
  dob: 'dateOfBirth', dateofbirth: 'dateOfBirth', dateofbirthyyyymmdd: 'dateOfBirth', birthday: 'dateOfBirth', birthdate: 'dateOfBirth',
  joined: 'joinedOn', joinedon: 'joinedOn', joindate: 'joinedOn', joinedyyyymmdd: 'joinedOn', membershipdate: 'joinedOn',
  firstvisit: 'firstVisitOn', firstvisiton: 'firstVisitOn', firstvisityyyymmdd: 'firstVisitOn', datevisited: 'firstVisitOn', dateofvisit: 'firstVisitOn', visited: 'firstVisitOn', visitdate: 'firstVisitOn',
  family: 'household', household: 'household', familygroup: 'household',
  status: 'membershipStatus', membership: 'membershipStatus', membershipstatus: 'membershipStatus', statusvisitorregularmember: 'membershipStatus',
  category: 'category', categorycongregationcontact: 'category', list: 'category',
  firstseenyear: 'firstSeenYear', seenyear: 'firstSeenYear',
  source: 'sourceList', sourcelist: 'sourceList', sources: 'sourceList',
  notes: 'notes', note: 'notes', comment: 'notes', comments: 'notes',
};
const STATUSES = new Set(['visitor', 'regular', 'member', 'inactive']);

// Fuzzy fallback: if a header isn't an exact alias, match on contained tokens so
// odd spreadsheet headers ("Mobile No.", "Member Since", "E-mail Address") still
// land on the right field. The confirm screen lets the user fix any mismatch.
const FIELD_TOKENS: Record<string, string[]> = {
  givenName: ['firstname', 'first', 'given', 'fname'],
  familyName: ['lastname', 'last', 'surname', 'family', 'lname'],
  email: ['email', 'mail'],
  homePhone: ['landline', 'housephone'],
  mobile: ['mobile', 'cell', 'whatsapp'],
  addressLine1: ['address', 'street'],
  city: ['city', 'town'],
  region: ['state', 'province', 'region'],
  postalCode: ['zip', 'postal', 'postcode'],
  country: ['country'],
  dateOfBirth: ['dob', 'birth', 'born'],
  joinedOn: ['join', 'membershipdate'],
  firstVisitOn: ['visit', 'firstseen'],
  household: ['household', 'family'],
  membershipStatus: ['status', 'membership'],
  category: ['category'],
};
function detectField(header: string): string | null {
  const n = norm(header);
  if (!n) return null;
  if (ALIASES[n]) return ALIASES[n];
  for (const [field, tokens] of Object.entries(FIELD_TOKENS)) {
    if (tokens.some((t) => n.includes(t))) return field;
  }
  return null;
}

function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const last10 = (s?: string | null) => { const d = (s || '').replace(/[^0-9]/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

// GET template (xlsx with the expected headers + one example row).
importRouter.get('/members/template', requirePermission('create person'), asyncHandler(async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Members');
  ws.addRow(COLUMNS.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  ws.addRow(['John', 'Doe', 'john@example.com', '+15551234567', '5085551234', '12 Main St', 'Boston', 'MA', '02118', 'USA', '1990-05-20', '2022-01-15', '2021-11-07', 'Doe Family', 'member', 'congregation']);
  COLUMNS.forEach((_c, i) => { ws.getColumn(i + 1).width = 24; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="members-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// Parse an uploaded file (base64) and return mapped rows + per-row flags.
const previewSchema = z.object({
  filename: z.string(),
  base64: z.string().max(12_000_000),
  // Optional user corrections from the confirm screen: header → field key ('' = ignore).
  overrides: z.record(z.string()).optional(),
});
importRouter.post('/members/preview', requirePermission('create person'), asyncHandler(async (req, res) => {
  const { filename, base64, overrides } = previewSchema.parse(req.body);
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
      for (let c = 1; c <= headers.length; c++) { const raw = row.getCell(c).value as unknown; let v: unknown = raw; if (raw && typeof raw === 'object') { const o = raw as { text?: string; result?: unknown }; v = o.text ?? o.result ?? ''; } vals.push(v); }
      if (vals.some((v) => v != null && String(v).trim() !== '')) dataRows.push(vals);
    }
  }

  // Smart mapping: a user override wins, else the auto-detector (alias + fuzzy).
  const map = headers.map((h) => {
    const o = overrides?.[h];
    if (o !== undefined) return o === '' ? null : o;
    return detectField(h);
  });
  const mapping = headers.map((h, i) => ({ header: h, field: map[i] }));
  if (!map.includes('givenName')) throw badRequest('No "First name" column detected. Use the confirm screen to point one at First name.');

  const rows = dataRows.map((cells, i) => {
    const values: Record<string, string> = {};
    map.forEach((key, ci) => { if (key) { const v = cells[ci]; values[key] = v == null ? '' : String(v).trim(); } });
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!values.givenName) errors.push('First name is required');
    if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.push('Invalid email');
    if (values.dateOfBirth) { const d = toDate(values.dateOfBirth); if (!d) warnings.push('Unrecognised date of birth'); else values.dateOfBirth = d; }
    if (values.joinedOn) { const d = toDate(values.joinedOn); if (!d) warnings.push('Unrecognised joined date'); else values.joinedOn = d; }
    if (values.firstVisitOn) { const d = toDate(values.firstVisitOn); if (!d) warnings.push('Unrecognised first-visit date'); else values.firstVisitOn = d; }
    if (values.membershipStatus && !STATUSES.has(values.membershipStatus.toLowerCase())) { warnings.push(`Unknown status "${values.membershipStatus}" — will use visitor`); }
    if (values.category && !['congregation', 'contact'].includes(values.category.toLowerCase())) { warnings.push(`Unknown category "${values.category}" — will use congregation`); }
    if (!values.email && !values.mobile && !values.homePhone) warnings.push('No email or phone');
    return { index: i + 2, values, errors, warnings };
  });

  res.json({ data: {
    rows,
    mapping,                                   // detected/overridden header → field
    fields: COLUMNS.map((c) => ({ key: c.key, label: c.header })), // choices for the confirm screen
    summary: { total: rows.length, ok: rows.filter((r) => r.errors.length === 0).length, errors: rows.filter((r) => r.errors.length > 0).length },
  } });
}));

// Import validated rows — dedupes against existing people (email/mobile).
const importSchema = z.object({ rows: z.array(z.record(z.string())).max(5000) });
importRouter.post('/members', requirePermission('create person'), asyncHandler(async (req, res) => {
  const { rows } = importSchema.parse(req.body);

  // Preload existing contact keys so we never duplicate people already in the DB
  // (small congregation → one pass). We also grow these sets as we insert, so
  // duplicates *within* the uploaded file are skipped too.
  const existing = await db.select({ email: people.email, mobile: people.mobile }).from(people).where(isNull(people.deletedAt));
  const emailSet = new Set<string>();
  const mobileSet = new Set<string>();
  for (const e of existing) { if (e.email) emailSet.add(e.email.toLowerCase()); const m = last10(e.mobile); if (m) mobileSet.add(m); }

  const householdCache = new Map<string, number>();
  let created = 0, skipped = 0, contacts = 0;
  for (const v of rows) {
    const given = (v.givenName ?? '').trim();
    if (!given) { continue; }
    const email = v.email?.trim() ? v.email.trim().toLowerCase() : null;
    // No mobile? fall back to the home phone so the person is still contactable.
    const mobile = (v.mobile?.trim() || v.homePhone?.trim()) || null;
    const m10 = last10(mobile);
    if ((email && emailSet.has(email)) || (m10 && mobileSet.has(m10))) { skipped++; continue; }

    let householdId: number | null = null;
    const fam = (v.household ?? v.familyName ?? '').trim();
    if (fam) {
      if (householdCache.has(fam)) householdId = householdCache.get(fam)!;
      else {
        const [ex] = await db.select({ id: households.id }).from(households).where(and(sql`${households.name}->>'en' = ${fam}`, isNull(households.deletedAt))).limit(1);
        if (ex) householdId = ex.id;
        else {
          const [h] = await db.insert(households).values({
            name: { en: fam },
            homePhone: v.homePhone?.trim() || null,
            addressLine1: v.addressLine1?.trim() || null, city: v.city?.trim() || null,
            region: v.region?.trim() || null, postalCode: v.postalCode?.trim() || null, country: v.country?.trim() || null,
          }).returning();
          householdId = h?.id ?? null;
        }
        if (householdId) householdCache.set(fam, householdId);
      }
    }

    const status = (v.membershipStatus ?? '').toLowerCase();
    const category = (v.category ?? '').toLowerCase() === 'contact' ? 'contact' : 'congregation';
    const custom: Record<string, string> = {};
    if (v.sourceList?.trim()) custom.sourceList = v.sourceList.trim();
    if (v.firstSeenYear?.trim()) custom.firstSeenYear = v.firstSeenYear.trim();

    await db.insert(people).values({
      givenName: { en: given },
      familyName: { en: (v.familyName ?? '').trim() },
      email,
      mobile,
      addressLine1: v.addressLine1?.trim() || null,
      city: v.city?.trim() || null,
      region: v.region?.trim() || null,
      postalCode: v.postalCode?.trim() || null,
      country: v.country?.trim() || null,
      dateOfBirth: toDate(v.dateOfBirth),
      joinedOn: toDate(v.joinedOn),
      firstVisitOn: toDate(v.firstVisitOn),
      householdId,
      membershipStatus: STATUSES.has(status) ? (status as 'visitor' | 'regular' | 'member' | 'inactive') : 'visitor',
      category,
      customFields: custom,
      notes: v.notes?.trim() || null,
    });
    if (email) emailSet.add(email);
    if (m10) mobileSet.add(m10);
    created++;
    if (category === 'contact') contacts++;
  }
  await logActivity(req, 'created', 'person', 0, `import: ${created} created, ${skipped} skipped (dup), ${contacts} contacts`);
  res.json({ data: { created, skipped, contacts } });
}));

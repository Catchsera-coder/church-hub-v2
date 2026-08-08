import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { checkinForms, type FormField } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import { logActivity } from '../activity/service.js';

// The starter form (also seeded as the default). Standard keys map to people
// columns; adding a custom key stores it in people.customFields.
export const DEFAULT_FORM_FIELDS: FormField[] = [
  { key: 'givenName', label: { en: 'First name', ar: 'الاسم الأول' }, type: 'text', required: true, forWhom: 'all' },
  { key: 'familyName', label: { en: 'Last name', ar: 'اسم العائلة' }, type: 'text', required: false, forWhom: 'all' },
  { key: 'mobile', label: { en: 'Mobile', ar: 'الجوال' }, type: 'tel', required: true, forWhom: 'primary' },
  { key: 'email', label: { en: 'Email', ar: 'البريد الإلكتروني' }, type: 'email', required: false, forWhom: 'primary' },
  { key: 'dateOfBirth', label: { en: 'Date of birth', ar: 'تاريخ الميلاد' }, type: 'date', required: false, forWhom: 'all' },
];

export const STANDARD_FIELD_KEYS = new Set([
  'givenName', 'familyName', 'mobile', 'email', 'dateOfBirth', 'preferredLanguage', 'householdRole',
]);

export const checkinFormsRouter = Router();
checkinFormsRouter.use(authenticate);
// Building/sharing intake forms is an admin concern.
checkinFormsRouter.use(requireRole('Admin'));

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.record(z.string()).default({}),
  type: z.enum(['text', 'tel', 'email', 'date', 'select', 'checkbox']),
  required: z.boolean().default(false),
  forWhom: z.enum(['primary', 'all']).default('all'),
  options: z.array(z.string().max(120)).max(30).optional(),
});
const formSchema = z.object({
  name: z.record(z.string()).default({}),
  intro: z.record(z.string()).default({}),
  fields: z.array(fieldSchema).max(40).default([]),
  showFamily: z.boolean().default(true),
  showConsent: z.boolean().default(true),
  active: z.boolean().default(true),
});

checkinFormsRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await db.select().from(checkinForms).orderBy(desc(checkinForms.isDefault), desc(checkinForms.id));
  res.json({ data: rows });
}));

checkinFormsRouter.get('/:id', asyncHandler(async (req, res) => {
  const [row] = await db.select().from(checkinForms).where(eq(checkinForms.id, Number(req.params.id))).limit(1);
  if (!row) throw notFound();
  res.json({ data: row });
}));

checkinFormsRouter.post('/', asyncHandler(async (req, res) => {
  const b = formSchema.parse(req.body);
  const [row] = await db.insert(checkinForms).values(b).returning();
  await logActivity(req, 'created', 'checkin_form', row!.id);
  res.status(201).json({ data: row });
}));

checkinFormsRouter.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = formSchema.partial().parse(req.body);
  const [row] = await db.update(checkinForms).set({ ...b, updatedAt: new Date() }).where(eq(checkinForms.id, id)).returning();
  if (!row) throw notFound();
  await logActivity(req, 'updated', 'checkin_form', id);
  res.json({ data: row });
}));

// Duplicate a form (fresh token, name suffixed) — a quick way to start a variant.
checkinFormsRouter.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const [src] = await db.select().from(checkinForms).where(eq(checkinForms.id, Number(req.params.id))).limit(1);
  if (!src) throw notFound();
  const name = { ...(src.name as Record<string, string>) };
  for (const k of Object.keys(name)) name[k] = `${name[k]} (copy)`;
  const [row] = await db.insert(checkinForms).values({
    name, intro: src.intro, fields: src.fields, showFamily: src.showFamily, showConsent: src.showConsent, active: src.active,
  }).returning();
  await logActivity(req, 'created', 'checkin_form', row!.id, 'duplicate');
  res.status(201).json({ data: row });
}));

checkinFormsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(checkinForms).where(eq(checkinForms.id, id)).limit(1);
  if (!row) throw notFound();
  if (row.isDefault) throw badRequest('The default form cannot be deleted.');
  await db.delete(checkinForms).where(eq(checkinForms.id, id));
  await logActivity(req, 'deleted', 'checkin_form', id);
  res.status(204).end();
}));

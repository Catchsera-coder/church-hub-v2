import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { people, attendanceRecords, messageTemplates } from '../../db/schema.js';
import { resolveMessaging, sendMessage, type ResolvedMessaging } from '../messages/delivery.js';
import { buildContext, renderText, brandedEmailHtml, localeName, type OrgBrand } from '../messages/render.js';

export type Channel = 'email' | 'sms' | 'whatsapp';
export interface RecipientRow {
  id: number;
  givenName: Record<string, string> | null;
  familyName: Record<string, string> | null;
  email: string | null;
  mobile: string | null;
  preferredLanguage: string;
  emailOptOut: boolean;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
}

const baseSelect = {
  id: people.id, givenName: people.givenName, familyName: people.familyName,
  email: people.email, mobile: people.mobile, preferredLanguage: people.preferredLanguage,
  emailOptOut: people.emailOptOut, smsOptOut: people.smsOptOut, whatsappOptOut: people.whatsappOptOut,
};

/** People matching an automation's trigger today (welcome is approval-triggered → none here). */
export async function recipientsFor(type: string, cfg: Record<string, number | string>): Promise<RecipientRow[]> {
  const active = and(eq(people.isActive, true), isNull(people.deletedAt));
  if (type === 'birthday') {
    return db.select(baseSelect).from(people)
      .where(and(active, sql`to_char(${people.dateOfBirth}, 'MM-DD') = to_char(now(), 'MM-DD')`));
  }
  if (type === 'join_anniversary') {
    return db.select(baseSelect).from(people)
      .where(and(active, sql`${people.joinedOn} < current_date`, sql`to_char(${people.joinedOn}, 'MM-DD') = to_char(now(), 'MM-DD')`));
  }
  if (type === 'first_visit_anniversary') {
    const fv = sql`(SELECT min(ar.checked_in_at) FROM ${attendanceRecords} ar WHERE ar.person_id = ${people.id})`;
    return db.select(baseSelect).from(people)
      .where(and(active, sql`to_char(${fv}, 'MM-DD') = to_char(now(), 'MM-DD')`, sql`${fv} < current_date - interval '1 day'`));
  }
  if (type === 'absence_followup') {
    const weeks = Number(cfg.absenceWeeks) || 4;
    return db.select(baseSelect).from(people).where(and(
      active,
      sql`EXISTS (SELECT 1 FROM ${attendanceRecords} ar WHERE ar.person_id = ${people.id})`,
      sql`NOT EXISTS (SELECT 1 FROM ${attendanceRecords} ar WHERE ar.person_id = ${people.id} AND ar.checked_in_at >= now() - (${weeks} * interval '1 week'))`,
    ));
  }
  return [];
}

function pickContact(p: RecipientRow, channel: Channel): { to: string; optedIn: boolean } | null {
  if (channel === 'email') return p.email ? { to: p.email, optedIn: !p.emailOptOut } : null;
  if (!p.mobile) return null;
  return { to: p.mobile, optedIn: channel === 'whatsapp' ? !p.whatsappOptOut : !p.smsOptOut };
}

/** Render a template for one person and send it on the channel (respects opt-out). */
export async function sendTemplateToPerson(
  p: RecipientRow, channel: Channel, tpl: { subject?: Record<string, string>; header?: Record<string, string>; body?: Record<string, string>; footer?: Record<string, string> },
  org: OrgBrand, messaging: ResolvedMessaging,
): Promise<boolean> {
  const c = pickContact(p, channel);
  if (!c || !c.optedIn) return false;
  const lang = p.preferredLanguage || 'en';
  const ctx = buildContext(p, org, new Date(), lang);
  const pick = (v?: Record<string, string>) => renderText((v?.[lang] ?? v?.en) ?? '', ctx);
  const subject = pick(tpl.subject);
  const bodyText = [pick(tpl.header), pick(tpl.body)].filter(Boolean).join('\n\n');
  const footer = pick(tpl.footer);
  const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
  if (channel === 'email') {
    const html = brandedEmailHtml(bodyText, org, { lang, signature, bodyFooterNote: footer || undefined });
    const plain = [bodyText, signature, footer].filter(Boolean).join('\n\n');
    return sendMessage(messaging, channel, c.to, subject, plain, html);
  }
  const plain = [bodyText, footer].filter(Boolean).join('\n\n');
  return sendMessage(messaging, channel, c.to, subject, plain);
}

/** Run one automation now: send its template to everyone it currently matches. */
export async function runAutomation(
  a: { type: string; channel: Channel; templateId: number | null; config: Record<string, number | string> },
  org: OrgBrand & { messaging?: unknown },
  messaging: ResolvedMessaging,
): Promise<{ sent: number; total: number }> {
  if (!a.templateId) return { sent: 0, total: 0 };
  const [tpl] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, a.templateId)).limit(1);
  if (!tpl) return { sent: 0, total: 0 };
  const recips = await recipientsFor(a.type, a.config);
  let sent = 0;
  for (const p of recips) if (await sendTemplateToPerson(p, a.channel, tpl, org, messaging)) sent++;
  return { sent, total: recips.length };
}

export { resolveMessaging };

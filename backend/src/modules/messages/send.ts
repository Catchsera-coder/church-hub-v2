import { and, eq, isNull, isNotNull, ne, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients, people } from '../../db/schema.js';
import { config } from '../../config.js';
import { currentOrg } from '../settings/routes.js';
import { resolveMessaging, sendMessage } from './delivery.js';
import { buildContext, renderText, brandedEmailHtml, localeName } from './render.js';

/**
 * Send a campaign to its whole eligible audience now. Shared by the manual send
 * route and the scheduler (scheduled campaigns). Personalises per recipient with
 * merge fields and brands email as HTML. Honest status: 'failed' if there were
 * recipients but none were accepted, else 'sent'.
 */
export async function sendCampaignNow(campaignId: number): Promise<{ sent: number; total: number }> {
  const [c] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId)).limit(1);
  if (!c) return { sent: 0, total: 0 };
  if (c.status === 'sent' || c.status === 'sending') return { sent: 0, total: 0 };

  const contactCol = c.channel === 'email' ? people.email : people.mobile;
  const optOutCol = c.channel === 'email' ? people.emailOptOut : c.channel === 'whatsapp' ? people.whatsappOptOut : people.smsOptOut;
  // Audience: 'all' opted-in on the channel, or an explicit person list chosen
  // in the composer (select-all / groups / unchecked). Null = all (legacy).
  const targetIds = c.audience?.mode === 'people' ? (c.audience.personIds ?? []) : null;
  const audience = targetIds && targetIds.length === 0 ? [] : await db
    .select({
      id: people.id, contact: contactCol, lang: people.preferredLanguage, unsubToken: people.unsubToken,
      givenName: people.givenName, familyName: people.familyName, email: people.email, mobile: people.mobile,
    })
    .from(people)
    .where(and(
      eq(people.isActive, true), isNull(people.deletedAt), isNotNull(contactCol), ne(contactCol, ''), eq(optOutCol, false),
      ...(targetIds ? [inArray(people.id, targetIds)] : []),
    ));

  await db.update(messageCampaigns).set({ status: 'sending', updatedAt: new Date() }).where(eq(messageCampaigns.id, campaignId));

  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
  const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  const now = new Date();

  let sent = 0;
  for (const p of audience) {
    const [rec] = await db.insert(messageRecipients).values({ messageCampaignId: campaignId, personId: p.id }).onConflictDoNothing().returning();
    if (!rec) continue;
    const lang = p.lang || 'en';
    const ctx = buildContext(p, org, now, lang);
    const subject = renderText(c.subject[lang] ?? c.subject.en ?? '', ctx);
    const body = renderText(c.body[lang] ?? c.body.en ?? '', ctx);
    const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
    const unsubscribeUrl = c.channel === 'email' && appUrl ? `${appUrl}/unsubscribe/${p.unsubToken}` : undefined;
    const cta = c.ctaLabel && c.ctaUrl ? { label: renderText(localeName(c.ctaLabel, lang), ctx), url: c.ctaUrl } : null;
    const html = c.channel === 'email'
      ? brandedEmailHtml(body, org, { lang, signature, unsubscribeUrl, cta })
      : undefined;
    const plain = [
      body,
      cta ? `${cta.label}: ${cta.url}` : '',
      signature,
      unsubscribeUrl ? `—\nTo stop receiving these emails, unsubscribe: ${unsubscribeUrl}` : '',
    ].filter(Boolean).join('\n\n');
    const ok = await sendMessage(messaging, c.channel, p.contact as string, subject, plain, html, c.mediaUrl ?? undefined);
    await db.update(messageRecipients).set({ status: ok ? 'sent' : 'failed' }).where(eq(messageRecipients.id, rec.id));
    if (ok) sent++;
  }

  const finalStatus = audience.length > 0 && sent === 0 ? 'failed' : 'sent';
  await db.update(messageCampaigns).set({ status: finalStatus, sentAt: new Date(), updatedAt: new Date() }).where(eq(messageCampaigns.id, campaignId));
  return { sent, total: audience.length };
}

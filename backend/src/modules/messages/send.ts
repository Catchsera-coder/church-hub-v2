import { and, eq, isNull, isNotNull, ne, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageCampaigns, messageRecipients, people } from '../../db/schema.js';
import { config } from '../../config.js';
import { currentOrg } from '../settings/routes.js';
import { resolveMessaging, sendMessage, sleep } from './delivery.js';
import { resolveAudienceIds, bypassOptIn } from './audience.js';
import { buildContext, renderText, brandedEmailHtml, localeName, linksToPlainText } from './render.js';
import { loadCampaignAttachments, prepareDelivery, dataUriAttachment, type OutAttachment } from './attach.js';

/**
 * Send a campaign to its whole eligible audience now. Shared by the manual send
 * route and the scheduler (scheduled campaigns). Personalises per recipient with
 * merge fields and brands email as HTML. Honest status: 'failed' if there were
 * recipients but none were accepted, else 'sent'.
 */
export async function sendCampaignNow(campaignId: number, sentByUserId?: number): Promise<{ sent: number; total: number }> {
  const [c] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId)).limit(1);
  if (!c) return { sent: 0, total: 0 };
  if (c.status === 'sent' || c.status === 'sending') return { sent: 0, total: 0 };

  const contactCol = c.channel === 'email' ? people.email : people.mobile;
  const optOutCol = c.channel === 'email' ? people.emailOptOut : c.channel === 'whatsapp' ? people.whatsappOptOut : people.smsOptOut;
  // Audience resolved to concrete ids (null = everyone opted-in). Dynamic modes
  // (ministries/segment) re-resolve here, so a recurring send always hits the
  // current roster / segment.
  const targetIds = await resolveAudienceIds(c.audience);
  const audience = targetIds && targetIds.length === 0 ? [] : await db
    .select({
      id: people.id, contact: contactCol, lang: people.preferredLanguage, unsubToken: people.unsubToken,
      givenName: people.givenName, familyName: people.familyName, email: people.email, mobile: people.mobile,
    })
    .from(people)
    .where(and(
      eq(people.isActive, true), isNull(people.deletedAt), isNotNull(contactCol), ne(contactCol, ''),
      ...(bypassOptIn(c.channel, c.audience) ? [] : [eq(optOutCol, false)]),
      ...(targetIds ? [inArray(people.id, targetIds)] : []),
    ));

  await db.update(messageCampaigns).set({ status: 'sending', updatedAt: new Date() }).where(eq(messageCampaigns.id, campaignId));

  const org = await currentOrg();
  const messaging = resolveMessaging(org.messaging, { replyTo: org.emailSettings?.replyTo || org.email });
  const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  const now = new Date();

  // Attachments: computed once and reused for every recipient. `inline` files are
  // attached to email (within the provider cap); `linkLines` are secure download
  // links appended to the body (SMS/WhatsApp, or oversized email).
  const prepared = await prepareDelivery(await loadCampaignAttachments(campaignId), c.channel, appUrl, (c.imagePlacement as 'body' | 'attach' | 'both') ?? 'body');
  // Embed the church logo + header photo as inline CID images so they always show
  // in the recipient's email (not just in the in-app preview).
  const logoAtt = c.channel === 'email' ? dataUriAttachment(org.logoPath, 'logo', 'logo') : null;
  const headerAtt = c.channel === 'email' ? dataUriAttachment(org.emailSettings?.headerImage, 'header', 'headerimg') : null;
  const brandAtts: OutAttachment[] = [logoAtt, headerAtt].filter((x): x is OutAttachment => Boolean(x));

  let sent = 0;
  for (const p of audience) {
    const nm = [localeName(p.givenName, p.lang || 'en'), localeName(p.familyName, p.lang || 'en')].filter(Boolean).join(' ').trim();
    const [rec] = await db.insert(messageRecipients)
      .values({ messageCampaignId: campaignId, personId: p.id, toContact: (p.contact as string) ?? null, resolvedName: nm || null })
      .onConflictDoNothing().returning();
    if (!rec) continue;
    const lang = p.lang || 'en';
    const ctx = buildContext(p, org, now, lang);
    const subject = renderText(c.subject[lang] ?? c.subject.en ?? '', ctx);
    const body = renderText(c.body[lang] ?? c.body.en ?? '', ctx);
    const signature = renderText(localeName(org.emailSettings?.signature, lang), ctx) || undefined;
    const unsubscribeUrl = c.channel === 'email' && appUrl ? `${appUrl}/unsubscribe/${p.unsubToken}` : undefined;
    // RFC 8058 one-click unsubscribe target (POST) for the List-Unsubscribe header.
    const oneClickUnsub = c.channel === 'email' && appUrl ? `${appUrl}/api/public/unsubscribe/${p.unsubToken}/one-click` : undefined;
    const cta = c.ctaLabel && c.ctaUrl ? { label: renderText(localeName(c.ctaLabel, lang), ctx), url: c.ctaUrl } : null;
    // Fold any attachment download links into the body so they appear in-message.
    const bodyWithLinks = prepared.linkLines.length ? `${body}\n\n${prepared.linkLines.join('\n')}` : body;
    const html = c.channel === 'email'
      ? brandedEmailHtml(bodyWithLinks, org, { lang, signature, unsubscribeUrl, cta, attachmentsHtml: prepared.imagesHtml, logoCid: logoAtt ? 'logo' : undefined, headerImageCid: headerAtt ? 'headerimg' : undefined })
      : undefined;
    // Plain-text part: flatten any [label](url) markdown so links stay usable.
    const plain = [
      linksToPlainText(bodyWithLinks),
      cta ? `${cta.label}: ${cta.url}` : '',
      signature,
      unsubscribeUrl ? `—\nTo stop receiving these emails, unsubscribe: ${unsubscribeUrl}` : '',
    ].filter(Boolean).join('\n\n');
    const emailAtts = c.channel === 'email' ? [...brandAtts, ...prepared.inline] : prepared.inline;
    const ok = await sendMessage(messaging, c.channel, p.contact as string, subject, plain, html, c.mediaUrl ?? undefined, emailAtts, oneClickUnsub);
    await db.update(messageRecipients)
      .set({ status: ok ? 'sent' : 'failed', sentAt: new Date(), error: ok ? null : 'Provider did not accept the message' })
      .where(eq(messageRecipients.id, rec.id));
    if (ok) sent++;
    // Gentle pacing to smooth bursts under the provider per-minute caps (SMS
    // toll-free 200/min, ACS custom-domain email 30/min); the delivery layer also
    // retries on 429, so nothing is dropped. For very large church-wide blasts
    // prefer scheduling the campaign — the background worker drains it without
    // holding an HTTP request open.
    await sleep(75);
  }

  const finalStatus = audience.length > 0 && sent === 0 ? 'failed' : 'sent';
  await db.update(messageCampaigns)
    .set({ status: finalStatus, sentAt: new Date(), updatedAt: new Date(), ...(sentByUserId ? { sentByUserId } : {}) })
    .where(eq(messageCampaigns.id, campaignId));
  return { sent, total: audience.length };
}

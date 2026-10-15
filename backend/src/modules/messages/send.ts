import { and, eq, isNull, isNotNull, ne, inArray, sql } from 'drizzle-orm';
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
// A provider rate-limit / throttle (e.g. ACS PerSubscriptionPerHourLimitExceeded,
// HTTP 429). When we hit this we STOP, leave the rest as 'pending', and let the
// user Resume later (after the limit resets) — nothing is lost or marked failed.
export const isRateLimited = (error?: string | null): boolean =>
  /\b429\b|TooManyRequests|LimitExceeded|throttl/i.test(error ?? '');

export async function sendCampaignNow(
  campaignId: number,
  sentByUserId?: number,
  opts: { resume?: boolean } = {},
): Promise<{ sent: number; total: number; rateLimited: boolean; pending: number }> {
  const [c] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId)).limit(1);
  if (!c) return { sent: 0, total: 0, rateLimited: false, pending: 0 };
  // First send is blocked if already sent/sending; Resume (opts.resume) bypasses
  // so a stalled or partly-failed campaign can be re-driven (only un-sent go out).
  if (!opts.resume && (c.status === 'sent' || c.status === 'sending')) return { sent: 0, total: 0, rateLimited: false, pending: 0 };

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

  // Mark 'sending' and take a 15-min processing lease (nextBatchAt in the future)
  // so the background drainer won't start a second batch while this one runs. The
  // final update below overwrites nextBatchAt with the real resume time (or null).
  await db.update(messageCampaigns).set({ status: 'sending', nextBatchAt: new Date(Date.now() + 15 * 60_000), updatedAt: new Date() }).where(eq(messageCampaigns.id, campaignId));

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
  let rateLimited = false;
  let retryAfterSec = 0;
  for (const p of audience) {
    const nm = [localeName(p.givenName, p.lang || 'en'), localeName(p.familyName, p.lang || 'en')].filter(Boolean).join(' ').trim();
    // Idempotent: a fresh insert gives a new 'pending' row; on Resume the row
    // already exists — reuse it, and SKIP anyone already delivered so a resumed
    // send never double-sends.
    let rec = (await db.insert(messageRecipients)
      .values({ messageCampaignId: campaignId, personId: p.id, toContact: (p.contact as string) ?? null, resolvedName: nm || null })
      .onConflictDoNothing().returning())[0];
    if (!rec) {
      const [ex] = await db.select().from(messageRecipients)
        .where(and(eq(messageRecipients.messageCampaignId, campaignId), eq(messageRecipients.personId, p.id))).limit(1);
      if (!ex || ex.status === 'sent') continue; // already delivered — leave it
      rec = ex;
    }
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
    const result = await sendMessage(messaging, c.channel, p.contact as string, subject, plain, html, c.mediaUrl ?? undefined, emailAtts, oneClickUnsub);
    // Hit the provider's rate/hour limit → STOP here, leave this + the rest as
    // 'pending' (don't mark failed), and let the user Resume after it resets.
    if (!result.ok && isRateLimited(result.error)) { rateLimited = true; retryAfterSec = result.retryAfter ?? 3600; break; }
    await db.update(messageRecipients)
      .set({ status: result.ok ? 'sent' : 'failed', sentAt: new Date(), error: result.ok ? null : (result.error ?? 'Provider did not accept the message').slice(0, 500) })
      .where(eq(messageRecipients.id, rec.id));
    if (result.ok) sent++;
    // Pace sends to stay under the provider's per-minute cap (ACS custom-domain
    // email ~30/min; the delivery layer also retries short 429s). The per-HOUR
    // cap is handled by the rate-limit pause + Resume above.
    await sleep(c.channel === 'email' ? 300 : 75);
  }

  // How many are still waiting (rate-limit pause, or never reached).
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*) filter (where ${messageRecipients.status} = 'pending')::int` })
    .from(messageRecipients).where(eq(messageRecipients.messageCampaignId, campaignId));

  // Rate-limited or anyone still pending → keep 'sending' (resumable) and set when
  // the background drainer should send the next batch: after the provider's cap
  // resets (rate-limit) or soon (a normal pause). Complete → finalise 'sent'.
  const incomplete = rateLimited || pending > 0;
  const status = incomplete ? 'sending' : (sent > 0 || audience.length === 0 ? 'sent' : 'failed');
  const nextBatchAt = incomplete
    ? new Date(Date.now() + (rateLimited ? (retryAfterSec * 1000 + 30_000) : 120_000))
    : null;
  await db.update(messageCampaigns)
    .set({ status, nextBatchAt, sentAt: new Date(), updatedAt: new Date(), ...(sentByUserId ? { sentByUserId } : {}) })
    .where(eq(messageCampaigns.id, campaignId));
  return { sent, total: audience.length, rateLimited, pending };
}

import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageAttachments } from '../../db/schema.js';
import { getBytes } from '../../lib/storage.js';

/**
 * Attachment delivery: decide, per message, whether files are attached INLINE to
 * an email or delivered as secure download LINKS. Email carries files inline when
 * they fit the provider cap; SMS/WhatsApp (no attachments) and oversized email
 * fall back to links to the public download route (fresh signed URL per click).
 */

export type AttachmentRow = typeof messageAttachments.$inferSelect;
export interface OutAttachment { filename: string; contentType: string; base64: string; }
export type ImagePlacement = 'body' | 'attach' | 'both';

// Keep total inline email attachments comfortably under the ACS ~10 MB cap
// (attachments + body). Larger sets switch to links automatically.
const EMAIL_INLINE_CAP = 9 * 1024 * 1024;

const isImage = (a: AttachmentRow) => (a.contentType || '').toLowerCase().startsWith('image/');
const escapeAttr = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function loadCampaignAttachments(campaignId: number): Promise<AttachmentRow[]> {
  return db.select().from(messageAttachments).where(eq(messageAttachments.campaignId, campaignId));
}

export async function loadAttachmentsByTokens(tokens: string[]): Promise<AttachmentRow[]> {
  if (!tokens.length) return [];
  return db.select().from(messageAttachments).where(inArray(messageAttachments.token, tokens));
}

/**
 * Prepare attachments for one channel. `inline` are ready-to-attach files (email
 * within cap); `linkLines` are human-readable "name: url" lines to append to the
 * body (SMS/WhatsApp, or oversized/unfetchable email). Computed once per send and
 * reused for every recipient.
 */
export async function prepareDelivery(
  atts: AttachmentRow[],
  channel: 'email' | 'sms' | 'whatsapp',
  appUrl: string | undefined,
  imagePlacement: ImagePlacement = 'body',
): Promise<{ inline: OutAttachment[]; linkLines: string[]; imagesHtml: string }> {
  if (!atts.length) return { inline: [], linkLines: [], imagesHtml: '' };
  const link = (a: AttachmentRow) => appUrl ? `📎 ${a.filename}: ${appUrl}/api/public/attachments/${a.token}` : null;

  if (channel === 'email') {
    const images = atts.filter(isImage);
    const files = atts.filter((a) => !isImage(a));
    const wantBody = imagePlacement === 'body' || imagePlacement === 'both';
    const wantAttach = imagePlacement === 'attach' || imagePlacement === 'both';

    // Images shown inline in the body (needs a public URL email clients can fetch).
    const imagesHtml = wantBody && appUrl
      ? images.map((a) => `<img src="${appUrl}/api/public/attachments/${a.token}" alt="${escapeAttr(a.filename)}" style="max-width:100%;height:auto;border-radius:12px;margin:12px 0;display:block" />`).join('')
      : '';

    // What to attach as files: non-image files always; images when "attach"/"both",
    // or as a fallback when we wanted them in the body but have no public URL.
    const attachImages = wantAttach || (wantBody && !appUrl);
    const toAttach = [...files, ...(attachImages ? images : [])];
    const inline: OutAttachment[] = [];
    const linkLines: string[] = [];
    const total = toAttach.reduce((s, a) => s + (a.sizeBytes || 0), 0);
    if (total <= EMAIL_INLINE_CAP) {
      for (const a of toAttach) {
        const buf = await getBytes(a);
        if (buf) inline.push({ filename: a.filename, contentType: a.contentType, base64: buf.toString('base64') });
        else { const l = link(a); if (l) linkLines.push(l); }
      }
    } else {
      for (const a of toAttach) { const l = link(a); if (l) linkLines.push(l); }
    }
    return { inline, linkLines, imagesHtml };
  }
  // SMS/WhatsApp → links only.
  return { inline: [], linkLines: atts.map(link).filter((x): x is string => Boolean(x)), imagesHtml: '' };
}

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
export interface OutAttachment { filename: string; contentType: string; base64: string; contentId?: string }
export type ImagePlacement = 'body' | 'attach' | 'both';

/** Turn a stored data: URI (logo / header photo) into an inline CID attachment so
 * it's embedded in the email and always renders in the recipient's client. */
export function dataUriAttachment(dataUri: string | null | undefined, filename: string, contentId: string): OutAttachment | null {
  if (!dataUri) return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUri);
  if (!m) return null;
  return { filename, contentType: m[1], base64: m[2], contentId };
}

// Keep total inline email attachments comfortably under the ACS ~10 MB cap
// (attachments + body). Larger sets switch to links automatically.
const EMAIL_INLINE_CAP = 9 * 1024 * 1024;

const isImage = (a: AttachmentRow) => (a.contentType || '').toLowerCase().startsWith('image/');
const escapeAttr = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const imgTag = (src: string, name: string) => `<img src="${src}" alt="${escapeAttr(name)}" style="max-width:100%;height:auto;border-radius:12px;margin:12px 0;display:block" />`;

/**
 * Inline-image HTML for the IN-APP PREVIEW, using public URLs (which load in the
 * same-origin preview iframe) instead of cid: refs (which only resolve in a real
 * email client). Real sends use CID via prepareDelivery; preview uses this.
 */
export async function previewImagesHtml(tokens: string[], appUrl: string | undefined, imagePlacement: ImagePlacement = 'body'): Promise<string> {
  if (imagePlacement === 'attach' || !appUrl || !tokens.length) return '';
  const atts = await loadAttachmentsByTokens(tokens);
  return atts.filter(isImage).map((a) => imgTag(`${appUrl}/api/public/attachments/${a.token}`, a.filename)).join('');
}

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
    // 'body'/'both' → embed images inline (CID) so they render in the recipient's
    // client without fetching an external URL. 'attach' → attach as files.
    const embedInBody = imagePlacement === 'body' || imagePlacement === 'both';

    const inline: OutAttachment[] = [];
    const linkLines: string[] = [];
    let imagesHtml = '';
    let used = 0; // running total of embedded/attached bytes (keep under provider cap)

    // Fetch bytes once per attachment.
    const bytesOf = new Map<number, Buffer | null>();
    for (const a of atts) bytesOf.set(a.id, await getBytes(a));

    const attach = (a: AttachmentRow, cid?: string): boolean => {
      const buf = bytesOf.get(a.id);
      if (!buf || used + buf.length > EMAIL_INLINE_CAP) { const l = link(a); if (l) linkLines.push(l); return false; }
      inline.push({ filename: a.filename, contentType: a.contentType, base64: buf.toString('base64'), ...(cid ? { contentId: cid } : {}) });
      used += buf.length;
      return true;
    };

    if (embedInBody) {
      for (const a of images) {
        const cid = `img-${a.token}`;
        if (attach(a, cid)) imagesHtml += imgTag(`cid:${cid}`, a.filename);
        else if (appUrl) imagesHtml += imgTag(`${appUrl}/api/public/attachments/${a.token}`, a.filename); // too big to embed → link fallback
      }
    } else {
      for (const a of images) attach(a); // as a normal attachment
    }
    for (const a of files) attach(a);

    return { inline, linkLines, imagesHtml };
  }
  // SMS/WhatsApp → links only.
  return { inline: [], linkLines: atts.map(link).filter((x): x is string => Boolean(x)), imagesHtml: '' };
}

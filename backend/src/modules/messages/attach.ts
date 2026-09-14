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

// Keep total inline email attachments comfortably under the ACS ~10 MB cap
// (attachments + body). Larger sets switch to links automatically.
const EMAIL_INLINE_CAP = 9 * 1024 * 1024;

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
): Promise<{ inline: OutAttachment[]; linkLines: string[] }> {
  if (!atts.length) return { inline: [], linkLines: [] };
  const link = (a: AttachmentRow) => appUrl ? `📎 ${a.filename}: ${appUrl}/api/public/attachments/${a.token}` : null;

  if (channel === 'email') {
    const total = atts.reduce((s, a) => s + (a.sizeBytes || 0), 0);
    if (total <= EMAIL_INLINE_CAP) {
      const inline: OutAttachment[] = [];
      const linkLines: string[] = [];
      for (const a of atts) {
        const buf = await getBytes(a);
        if (buf) inline.push({ filename: a.filename, contentType: a.contentType, base64: buf.toString('base64') });
        else { const l = link(a); if (l) linkLines.push(l); } // couldn't fetch → fall back to a link
      }
      return { inline, linkLines };
    }
  }
  // SMS/WhatsApp, or an email set over the cap → links only.
  return { inline: [], linkLines: atts.map(link).filter((x): x is string => Boolean(x)) };
}

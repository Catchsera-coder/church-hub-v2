import type { I18n, EmailSettings } from '../../db/schema.js';
import { config } from '../../config.js';

/**
 * Template merge fields + branded email rendering. Shared by manual campaign
 * sends, automations, and transactional emails (password reset, welcome) so a
 * template written once renders the same, professional way everywhere.
 *
 * Merge tokens are {{key}} — unknown tokens are left blank (never leak "{{x}}").
 */
export type MergeContext = Record<string, string>;

export const localeName = (v: I18n | null | undefined, lang: string): string =>
  (v ? v[lang] || v.en || Object.values(v)[0] || '' : '');

/** Build the substitution values for one person in a given church + language. */
export function buildContext(
  person: { givenName?: I18n | null; familyName?: I18n | null; email?: string | null; mobile?: string | null; preferredLanguage?: string | null },
  org: { name?: I18n | null },
  today: Date,
  lang = 'en',
): MergeContext {
  const first = localeName(person.givenName, lang);
  const last = localeName(person.familyName, lang);
  return {
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`.trim(),
    churchName: localeName(org.name, lang),
    email: person.email ?? '',
    mobile: person.mobile ?? '',
    date: today.toISOString().slice(0, 10),
  };
}

/** Replace {{token}} occurrences; unknown tokens become empty strings. */
export function renderText(text: string, ctx: MergeContext): string {
  if (!text) return '';
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => ctx[key] ?? '');
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A single clickable link, email-client-safe.
const anchor = (url: string, label: string, color: string): string => {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return `<a href="${href}" target="_blank" rel="noopener" style="color:${color};text-decoration:underline;font-weight:600">${label}</a>`;
};

/**
 * Make links in the body actually clickable in the delivered email. Runs on
 * ALREADY-HTML-ESCAPED text. Supports markdown `[label](url)` (nice labels — e.g.
 * "Give via Venmo") and auto-links bare http(s):// and www. URLs. Bare-URL
 * linking skips text already inside an <a> so we never double-wrap.
 */
export function linkifyHtml(escaped: string, color: string): string {
  const md = escaped.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|www\.[^)\s]+)\)/g, (_m, label: string, url: string) => anchor(url, label, color));
  return md
    .split(/(<a\b[^>]*>.*?<\/a>)/gs)
    .map((chunk) => (chunk.startsWith('<a') ? chunk : chunk.replace(/(https?:\/\/[^\s<]+|www\.[a-z0-9][^\s<]+)/gi, (u) => anchor(u, u, color))))
    .join('');
}

/**
 * Flatten markdown for plain-text channels (SMS/WhatsApp and the email
 * plain-text fallback): `[label](url)` → "label: url", and strip the light
 * formatting markers (**bold**, *italic*, ## heading) so the text reads clean.
 */
export function linksToPlainText(text: string): string {
  return (text || '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|www\.[^)\s]+)\)/g, (_m, label: string, url: string) => `${label}: ${url}`)
    .replace(/^\s{0,3}#{1,3}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
}

/**
 * Inline formatting on ALREADY-HTML-ESCAPED text: **bold** and *italic*, then
 * links. Only generates a fixed, safe set of tags — the body is never raw HTML,
 * so there's no injection surface. Bold is applied before italic so `**x**`
 * isn't mis-read as italics.
 */
function renderInline(escaped: string, color: string): string {
  const withEmphasis = escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return linkifyHtml(withEmphasis, color);
}

const validHex = (v?: string | null): string | null =>
  v && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : null;

/** Org fields the branded email layout reads (a subset of the organisations row). */
export type OrgBrand = {
  name?: I18n | null;
  logoPath?: string | null;
  brandColor?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  emailSettings?: EmailSettings | null;
};

/** Render body text (already merge-substituted) into styled blocks: headings
 * (## bigger, ### medium), bullet and numbered lists, and paragraphs — with
 * bold, italic, link markdown and bare URLs. Everything is HTML-escaped first
 * and only a fixed set of tags is emitted, so a sender can format their email
 * without any raw-HTML/injection risk. */
function paragraphs(text: string, linkColor: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .filter((b) => b.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      // Heading (## big, ### medium) — a single-line block starting with #.
      if (lines.length === 1 && /^\s{0,3}#{2,3}\s+/.test(lines[0])) {
        const m = lines[0].match(/^\s{0,3}(#{2,3})\s+(.*)$/)!;
        const size = m[1].length === 2 ? '20px' : '17px';
        return `<p style="margin:14px 0 10px;font-size:${size};font-weight:700;line-height:1.35;color:#0f172a">${renderInline(m[2], linkColor)}</p>`;
      }
      // Bullet list — every line starts with "- " or "* ".
      if (lines.length > 0 && lines.every((l) => /^\s{0,3}[-*]\s+/.test(l))) {
        const items = lines.map((l) => `<li style="margin:0 0 5px;line-height:1.6">${renderInline(l.replace(/^\s{0,3}[-*]\s+/, ''), linkColor)}</li>`).join('');
        return `<ul style="margin:0 0 16px;padding-left:22px;font-size:15px;color:#0f172a">${items}</ul>`;
      }
      // Numbered list — every line starts with "1." / "1)".
      if (lines.length > 0 && lines.every((l) => /^\s{0,3}\d+[.)]\s+/.test(l))) {
        const items = lines.map((l) => `<li style="margin:0 0 5px;line-height:1.6">${renderInline(l.replace(/^\s{0,3}\d+[.)]\s+/, ''), linkColor)}</li>`).join('');
        return `<ol style="margin:0 0 16px;padding-left:22px;font-size:15px;color:#0f172a">${items}</ol>`;
      }
      return `<p style="margin:0 0 16px;line-height:1.65;font-size:15px;color:#0f172a">${renderInline(block.replace(/\n/g, '<br/>'), linkColor)}</p>`;
    })
    .join('');
}

/** Lighten (positive) or darken (negative) a #rrggbb hex by a percentage. */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + pct / 100));
  const g = clamp(((n >> 8) & 255) * (1 + pct / 100));
  const b = clamp((n & 255) * (1 + pct / 100));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Bulletproof, email-client-safe call-to-action button (centered). */
function ctaButton(cta: { label: string; url: string }, color: string): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:10px auto 6px"><tr><td style="border-radius:10px;background:${color};box-shadow:0 2px 8px rgba(15,23,42,0.18)">`
    + `<a href="${url}" target="_blank" rel="noopener" class="ch-btn" style="display:inline-block;padding:14px 38px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.2px;border-radius:10px">${label}</a>`
    + `</td></tr></table>`;
}

/** A refined detail card (e.g. the invitee's sign-in name + email). */
function highlightBox(h: { label: string; lines: string[] }, brand: string): string {
  const label = `<div style="font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${brand};margin:0 0 7px">${escapeHtml(h.label)}</div>`;
  const lines = h.lines
    .filter(Boolean)
    .map((l, i) => `<div style="font-size:${i === 0 ? '16px' : '14px'};font-weight:${i === 0 ? '600' : '400'};color:${i === 0 ? '#0f172a' : '#475569'};line-height:1.55">${escapeHtml(l)}</div>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr><td style="background:#f8fafc;border:1px solid #e8ecf1;border-left:3px solid ${brand};border-radius:10px;padding:15px 18px">${label}${lines}</td></tr></table>`;
}

/** Comma-join the church's postal address from the organisation row. */
function addressLine(org: OrgBrand): string {
  const cityRegion = [org.city, [org.region, org.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [org.addressLine1, org.addressLine2, cityRegion, org.country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Footer social links as reliable text links (SVG/emoji render inconsistently in email). */
function socialLinks(social: EmailSettings['social'], color: string): string {
  if (!social) return '';
  const items = [
    social.facebook && { label: 'Facebook', url: social.facebook },
    social.instagram && { label: 'Instagram', url: social.instagram },
    social.youtube && { label: 'YouTube', url: social.youtube },
  ].filter(Boolean) as Array<{ label: string; url: string }>;
  if (!items.length) return '';
  const links = items
    .map((i) => `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener" style="color:${color};text-decoration:none;font-weight:600">${i.label}</a>`)
    .join('<span style="color:#cbd5e1"> &middot; </span>');
  return `<div style="margin:10px 0 0">${links}</div>`;
}

/**
 * Wrap already-merge-rendered body text in a professional, church-branded HTML
 * email: logo/brand header, the body, an optional CTA button, an optional
 * sign-off, and a footer with the church's contact details, social links and
 * (for broadcasts) an unsubscribe link. All inline-styled for email clients.
 */
export function brandedEmailHtml(
  bodyText: string,
  org: OrgBrand,
  opts: {
    lang?: string;
    heading?: string;                         // elegant serif headline above the body
    signature?: string;                       // pre-rendered sign-off (merge already applied)
    highlight?: { label: string; lines: string[] }; // a refined detail card under the body
    cta?: { label: string; url: string } | null;
    unsubscribeUrl?: string;                  // broadcasts → shows an unsubscribe line
    bodyFooterNote?: string;                  // small note under the body (e.g. template footer)
    preheader?: string;                       // hidden inbox-preview text
    attachmentsHtml?: string;                 // pre-built inline image HTML (placed at [image] marker, else under the body)
    logoCid?: string;                         // when set, the logo is an embedded cid: image (real sends)
    headerImageCid?: string;                  // when set, the header photo is an embedded cid: image
  } = {},
): string {
  const lang = opts.lang ?? 'en';
  const es = org.emailSettings ?? {};
  const brand = validHex(org.brandColor) ?? '#3b3f8c';
  const btn = validHex(es.buttonColor) ?? brand;
  const name = escapeHtml(localeName(org.name, lang));

  // Email clients block data: URIs and can't send auth, so never embed the logo.
  // Use an external URL as-is; for a stored data: URI, point at the public logo
  // endpoint over https (Gmail loads that fine and the email stays small — no
  // giant data URI to trip the "message clipped" limit). Otherwise show the name.
  const appUrl = config.PUBLIC_APP_URL?.replace(/\/+$/, '');
  const logoSrc = opts.logoCid
    ? `cid:${opts.logoCid}`
    : (org.logoPath ? (/^https?:\/\//i.test(org.logoPath) ? org.logoPath : (appUrl ? `${appUrl}/api/public/branding/logo` : null)) : null);
  // Header layout: logo on the LEFT with the church name beside it (once), and an
  // optional church header photo/banner on the RIGHT (set in Settings → email
  // branding). Data: URIs go through the public branding endpoints (email clients
  // block data: URIs); external https URLs are used as-is.
  // Compact, professional lockup: a right-sized logo (height-capped) BESIDE the
  // church name — never a full-width image. The `ch-logo`/`ch-photo` classes let
  // the media query shrink them a touch more on phones.
  const logoImg = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${name}" class="ch-logo" width="44" height="44" style="height:44px;width:auto;max-width:120px;object-fit:contain;display:block" />`
    : '';
  const headerName = `<span style="font-size:${logoSrc ? '19px' : '22px'};font-weight:700;color:#ffffff;line-height:1.2;letter-spacing:.2px">${name}</span>`;
  const headerImgVal = es.headerImage;
  const headerImgSrc = opts.headerImageCid
    ? `cid:${opts.headerImageCid}`
    : (headerImgVal ? (/^https?:\/\//i.test(headerImgVal) ? headerImgVal : (appUrl ? `${appUrl}/api/public/branding/header-image` : null)) : null);
  const headerPhoto = headerImgSrc
    ? `<img src="${escapeHtml(headerImgSrc)}" alt="" class="ch-photo" style="height:48px;width:auto;max-width:110px;object-fit:contain;border-radius:8px;display:block" />`
    : '';

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>`
    : '';

  const heading = opts.heading
    ? `<h1 class="ch-h1" style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a">${escapeHtml(opts.heading)}</h1>`
    : '';
  const highlight = opts.highlight ? highlightBox(opts.highlight, brand) : '';
  // Images go where the sender put an [image] marker in the text; otherwise under
  // the body. (renderText leaves [image] untouched — unlike {{tokens}}.)
  const imagesBlock = opts.attachmentsHtml ?? '';
  const body = imagesBlock && /\[images?\]/i.test(bodyText)
    ? bodyText.split(/\[images?\]/i).map((seg) => paragraphs(seg, brand)).join(imagesBlock)
    : paragraphs(bodyText, brand) + imagesBlock;
  const cta = opts.cta && opts.cta.url && opts.cta.label ? ctaButton(opts.cta, btn) : '';
  const signature = opts.signature
    ? `<div style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#0f172a">${escapeHtml(opts.signature).replace(/\n/g, '<br/>')}</div>`
    : '';
  const bodyNote = opts.bodyFooterNote
    ? `<div style="margin:20px 0 0;color:#475569;font-size:13px;line-height:1.5">${escapeHtml(opts.bodyFooterNote).replace(/\n/g, '<br/>')}</div>`
    : '';

  // --- Footer (church contact + social + unsubscribe) ---
  const showContact = es.showContactFooter !== false;
  const address = showContact ? addressLine(org) : '';
  const contactBits = showContact
    ? [org.phone, org.email, es.website].map((s) => (s ?? '').trim()).filter(Boolean)
    : [];
  const contactLine = [address, contactBits.join('  •  ')].filter(Boolean).join('<br/>');
  const social = showContact ? socialLinks(es.social, brand) : '';
  const unsub = opts.unsubscribeUrl
    ? `<div style="margin:12px 0 0"><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline">Unsubscribe</a></div>`
    : '';
  const footerInner = [
    `<div style="font-weight:600;color:#475569">${name}</div>`,
    contactLine ? `<div style="margin:6px 0 0">${contactLine}</div>` : '',
    social,
    unsub,
  ].filter(Boolean).join('');
  const footer = footerInner
    ? `<tr><td class="ch-foot" style="padding:18px 28px 24px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;text-align:center">${footerInner}</td></tr>`
    : '';

  const brandDark = shade(brand, -16);
  // Mobile-first: fluid 600px container (shrinks to the screen), plus a media
  // query that tightens padding, drops the corners edge-to-edge, and makes the
  // CTA full-width on phones. Inline styles remain the desktop/Outlook fallback.
  // NOTE: never force height:auto on ALL images — that would blow up the fixed-size
  // header logo/photo. Only BODY images get fluid sizing (via their own inline
  // max-width:100%, and the .ch-bimg class below for safety).
  const style = `<style>`
    + `img{border:0;outline:none;text-decoration:none}`
    + `.ch-bimg{max-width:100%!important;height:auto!important}`
    + `@media only screen and (max-width:600px){`
    + `.ch-wrap{width:100%!important;border-radius:0!important}`
    + `.ch-head{padding:16px 18px!important}`
    + `.ch-pad{padding:20px 18px!important}`
    + `.ch-foot{padding:16px 18px!important}`
    + `.ch-btn{display:block!important;text-align:center!important;padding-left:18px!important;padding-right:18px!important}`
    + `.ch-h1{font-size:20px!important}`
    + `.ch-logo{height:36px!important}`
    + `.ch-photo{height:40px!important}`
    + `}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>${style}</head>`
    + `<body style="margin:0;background:#eef1f5;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + preheader
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ch-wrap" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.10)">`
    + `<tr><td class="ch-head" style="background:${brand};padding:20px 28px">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="vertical-align:middle;text-align:left">`
          + `<table role="presentation" cellpadding="0" cellspacing="0"><tr>`
            + (logoImg ? `<td style="vertical-align:middle;padding-right:12px">${logoImg}</td>` : '')
            + `<td style="vertical-align:middle">${headerName}</td>`
          + `</tr></table>`
        + `</td>`
        + (headerPhoto ? `<td style="vertical-align:middle;text-align:right;white-space:nowrap">${headerPhoto}</td>` : '')
      + `</tr></table>`
    + `</td></tr>`
    + `<tr><td style="height:4px;background:${brandDark};font-size:0;line-height:0">&nbsp;</td></tr>`
    + `<tr><td class="ch-pad" style="padding:34px 36px">${heading}${body}${highlight}${cta}${signature}${bodyNote}</td></tr>`
    + footer
    + `</table>`
    + `</body></html>`;
}

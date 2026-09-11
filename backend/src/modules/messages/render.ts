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

/** Render body text (already merge-substituted) into styled paragraphs. */
function paragraphs(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== '')
    .map((p) => `<p style="margin:0 0 16px;line-height:1.65;font-size:15px;color:#0f172a">${p.replace(/\n/g, '<br/>')}</p>`)
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
    + `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 38px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.2px;border-radius:10px">${label}</a>`
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
  const logoSrc = org.logoPath
    ? (/^https?:\/\//i.test(org.logoPath) ? org.logoPath : (appUrl ? `${appUrl}/api/public/branding/logo` : null))
    : null;
  // Centered logo with the church name beneath it (name only, larger, when no logo).
  const logoImg = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${name}" style="height:54px;max-width:220px;object-fit:contain;display:block;margin:0 auto 10px" />`
    : '';
  const headerName = logoSrc
    ? `<div style="font-size:14px;font-weight:600;letter-spacing:.5px;color:rgba(255,255,255,0.9);margin:0">${name}</div>`
    : `<div style="font-size:22px;font-weight:700;color:#ffffff;margin:0">${name}</div>`;

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>`
    : '';

  const heading = opts.heading
    ? `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a">${escapeHtml(opts.heading)}</h1>`
    : '';
  const highlight = opts.highlight ? highlightBox(opts.highlight, brand) : '';
  const body = paragraphs(bodyText);
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
    ? `<tr><td style="padding:18px 28px 24px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;text-align:center">${footerInner}</td></tr>`
    : '';

  const brandDark = shade(brand, -16);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>`
    + `<body style="margin:0;background:#eef1f5;padding:28px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + preheader
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.10)">`
    + `<tr><td style="background:${brand};padding:32px 28px 26px;text-align:center">${logoImg}${headerName}</td></tr>`
    + `<tr><td style="height:4px;background:${brandDark};font-size:0;line-height:0">&nbsp;</td></tr>`
    + `<tr><td style="padding:34px 36px">${heading}${body}${highlight}${cta}${signature}${bodyNote}</td></tr>`
    + footer
    + `</table>`
    + `<div style="max-width:600px;margin:14px auto 0;text-align:center;color:#94a3b8;font-size:11px;line-height:1.5">${name}</div>`
    + `</body></html>`;
}

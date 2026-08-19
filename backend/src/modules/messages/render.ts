import type { I18n, EmailSettings } from '../../db/schema.js';

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

/** Bulletproof, email-client-safe call-to-action button. */
function ctaButton(cta: { label: string; url: string }, color: string): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td style="border-radius:8px;background:${color}">`
    + `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 30px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">${label}</a>`
    + `</td></tr></table>`;
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
    signature?: string;                       // pre-rendered sign-off (merge already applied)
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

  const logo = org.logoPath && /^data:image\//.test(org.logoPath)
    ? `<img src="${org.logoPath}" alt="${name}" style="height:44px;max-width:200px;object-fit:contain" />`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff;margin:0">${name}</div>`;

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>`
    : '';

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

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>`
    + `<body style="margin:0;background:#f1f5f9;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`
    + preheader
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08)">`
    + `<tr><td style="background:${brand};padding:22px 28px">${logo}</td></tr>`
    + `<tr><td style="padding:28px">${body}${cta}${signature}${bodyNote}</td></tr>`
    + footer
    + `</table></body></html>`;
}

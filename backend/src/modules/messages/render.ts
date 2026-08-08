import type { I18n } from '../../db/schema.js';

/**
 * Template merge fields + branded email rendering. Shared by manual campaign
 * sends and (Phase 5) automations, so a template written once renders the same
 * everywhere.
 *
 * Merge tokens are {{key}} — unknown tokens are left blank (never leak "{{x}}").
 */
export type MergeContext = Record<string, string>;

const localeName = (v: I18n | null | undefined, lang: string): string =>
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

/**
 * Wrap a plain-text (already merge-rendered) email body in a branded HTML shell:
 * the church logo + brand-colour header bar, the body with paragraphs, and an
 * optional footer. All inline-styled for email-client compatibility.
 */
export function brandedEmailHtml(
  bodyText: string,
  org: { name?: I18n | null; logoPath?: string | null; brandColor?: string | null },
  opts: { footer?: string; lang?: string } = {},
): string {
  const brand = org.brandColor && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(org.brandColor) ? org.brandColor : '#3b3f8c';
  const name = escapeHtml(localeName(org.name, opts.lang ?? 'en'));
  const logo = org.logoPath && /^data:image\//.test(org.logoPath)
    ? `<img src="${org.logoPath}" alt="" style="height:40px;max-width:180px;object-fit:contain" />`
    : `<div style="font-size:20px;font-weight:700;color:#fff">${name}</div>`;
  const bodyHtml = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  const footer = opts.footer ? `<div style="margin-top:24px;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml(opts.footer).replace(/\n/g, '<br/>')}</div>` : '';

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${brand};padding:20px 24px">${logo}</td></tr>
<tr><td style="padding:24px">${bodyHtml}${footer}</td></tr>
</table></body></html>`;
}

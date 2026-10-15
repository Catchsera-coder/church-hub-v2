import sanitizeHtml from 'sanitize-html';

/**
 * Sanitise rich-text email bodies coming from the WYSIWYG editor. Only a small,
 * email-client-safe set of tags and inline styles is kept; scripts, event
 * handlers, unknown tags/attributes and dangerous URL schemes are removed. This
 * is the trust boundary — the editor output is never used raw.
 */
const colorRe = [/^#(0x)?[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/];

export function sanitizeEmailHtml(dirty: string): string {
  return sanitizeHtml(dirty || '', {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'font'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        color: colorRe,
        'background-color': colorRe,
        'font-weight': [/^(bold|bolder|normal|[1-9]00)$/],
        'font-style': [/^(italic|normal)$/],
        'text-decoration': [/^(underline|line-through|none)$/],
        'font-size': [/^(1[0-9]|2[0-8])px$/, /^(x-small|small|medium|large|x-large)$/],
        'text-align': [/^(left|right|center|justify)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // Links always open safely in a new tab.
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
      // Some browsers' colour command emits <font color>; fold it into a span style.
      font: (_t, attribs) => ({ tagName: 'span', attribs: { style: attribs.color ? `color:${attribs.color}` : '' } }),
    },
  });
}

/** Plain-text version of a rich body for SMS/WhatsApp and the email text part. */
export function htmlToText(html: string): string {
  const s = (html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|h2|h3|li|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

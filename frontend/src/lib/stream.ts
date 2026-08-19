// Resolve a ministry's live-stream link. 'manual' → the fixed URL. 'youtube' →
// the channel's /live permalink, which YouTube always redirects to the current
// live stream (so no API/keys are needed — the same link works every week).

export type Streaming = { mode: 'manual' | 'youtube'; url?: string; youtube?: string };

export function resolveStreamLink(s: Streaming | null | undefined): string {
  if (!s) return '';
  if (s.mode === 'manual') return (s.url ?? '').trim();
  const h = (s.youtube ?? '').trim();
  if (!h) return '';
  // Full URL given → append /live.
  if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, '') + '/live';
  // A raw channel id (starts UC…) vs a handle (@name or name).
  if (/^UC[\w-]{20,}$/.test(h)) return `https://www.youtube.com/channel/${h}/live`;
  const handle = h.startsWith('@') ? h : '@' + h;
  return `https://www.youtube.com/${handle}/live`;
}

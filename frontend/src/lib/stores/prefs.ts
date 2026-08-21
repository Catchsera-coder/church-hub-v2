import { writable } from 'svelte/store';

// Per-device display preferences (not church-wide). Persisted in localStorage.
export type NameOrder = 'given-first' | 'family-first';

const isBrowser = typeof window !== 'undefined';

function persisted<T extends string>(key: string, initial: T) {
  const start = (isBrowser && (localStorage.getItem(key) as T | null)) || initial;
  const store = writable<T>(start);
  if (isBrowser) store.subscribe((v) => localStorage.setItem(key, v));
  return store;
}

// How to show people's names in lists: "Given Family" or "Family Given".
export const nameOrder = persisted<NameOrder>('name-order', 'given-first');

// --- Page tips / hints -------------------------------------------------------
// Master on/off for the little "how to use this page" hint banners (device-level).
export const pageTips = persisted<'on' | 'off'>('page-tips', 'on');

// The set of individually-dismissed hint ids (persisted as a JSON array). A hint
// shows when pageTips === 'on' AND its id isn't in this set. "Reset" clears it.
const HINTS_KEY = 'dismissed-hints';
function loadDismissed(): string[] {
  if (!isBrowser) return [];
  try { return JSON.parse(localStorage.getItem(HINTS_KEY) || '[]'); } catch { return []; }
}
export const dismissedHints = writable<string[]>(loadDismissed());
if (isBrowser) dismissedHints.subscribe((v) => localStorage.setItem(HINTS_KEY, JSON.stringify(v)));

export function dismissHint(id: string) {
  dismissedHints.update((list) => (list.includes(id) ? list : [...list, id]));
}
export function resetHints() { dismissedHints.set([]); }

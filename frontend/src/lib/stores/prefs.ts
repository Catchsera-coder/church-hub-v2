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

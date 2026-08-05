import { writable } from 'svelte/store';

// Per-device appearance: theme, font size scale, and bold text. Applied to the
// document root and persisted in localStorage so it survives reloads and applies
// on every page (including the login screen).
export type Theme = 'light' | 'dark';

export const theme = writable<Theme>('light');
export const fontScale = writable<number>(1); // 0.9 (small) .. 1.3 (extra large)
export const boldText = writable<boolean>(false);

const isBrowser = typeof window !== 'undefined';
let started = false;

export function initAppearance(): void {
  if (!isBrowser || started) return;
  started = true;

  const savedTheme = localStorage.getItem('theme') as Theme | null;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  theme.set(savedTheme ?? (prefersDark ? 'dark' : 'light'));
  fontScale.set(Number(localStorage.getItem('fontScale')) || 1);
  boldText.set(localStorage.getItem('boldText') === '1');

  const root = document.documentElement;
  // subscribe() fires immediately with the current value, so this both applies
  // and keeps applying on every change.
  theme.subscribe((v) => { localStorage.setItem('theme', v); root.classList.toggle('dark', v === 'dark'); });
  fontScale.subscribe((v) => { localStorage.setItem('fontScale', String(v)); root.style.fontSize = `${Math.round(16 * v)}px`; });
  boldText.subscribe((v) => { localStorage.setItem('boldText', v ? '1' : '0'); root.classList.toggle('appearance-bold', v); });
}

export function toggleTheme(): void {
  theme.update((v) => (v === 'dark' ? 'light' : 'dark'));
}

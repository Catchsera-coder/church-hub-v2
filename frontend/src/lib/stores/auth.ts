import { writable, get } from 'svelte/store';

export interface AuthUser { id: number; name: string; email: string; locale: string }
interface AuthState {
  user: AuthUser | null;
  roles: string[];
  perms: string[];
  accessToken: string | null;
  refreshToken: string | null;
}

const KEY = 'church-hub-auth';

function load(): AuthState {
  if (typeof localStorage === 'undefined') return empty();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthState) : empty();
  } catch {
    return empty();
  }
}
const empty = (): AuthState => ({ user: null, roles: [], perms: [], accessToken: null, refreshToken: null });

export const auth = writable<AuthState>(load());

auth.subscribe((s) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s));
});

export function setSession(data: Partial<AuthState>) {
  auth.update((s) => ({ ...s, ...data }));
}
export function clearSession() {
  auth.set(empty());
}
export function isAuthed(): boolean {
  return !!get(auth).accessToken;
}
/** Super Admin passes everything (mirrors the backend). */
export function can(perm: string): boolean {
  const s = get(auth);
  return s.roles.includes('Super Admin') || s.perms.includes(perm);
}
export function hasRole(role: string): boolean {
  const s = get(auth);
  return s.roles.includes('Super Admin') || s.roles.includes(role);
}

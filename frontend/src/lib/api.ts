import { get } from 'svelte/store';
import { auth, setSession, clearSession } from './stores/auth.js';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function refreshTokens(): Promise<boolean> {
  const rt = get(auth).refreshToken;
  if (!rt) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });
  if (!res.ok) {
    clearSession();
    return false;
  }
  const data = await res.json();
  setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, roles: data.roles ?? get(auth).roles, perms: data.perms ?? get(auth).perms });
  return true;
}

/**
 * Fetch the API with the access token attached. On a 401 it transparently
 * refreshes once and retries — so a client SPA session stays alive without the
 * user noticing token rotation.
 */
export async function api<T = unknown>(path: string, opts: RequestInit = {}, retry = true): Promise<T> {
  const token = get(auth).accessToken;
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...opts, headers });

  if (res.status === 401 && retry && (await refreshTokens())) {
    return api<T>(path, opts, false);
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? 'Request failed', e.code, e.details);
  }
  return data as T;
}

import type { Handle } from '@sveltejs/kit';

/**
 * Production API proxy.
 *
 * The SPA calls the API at the *relative* path `/api/...` (see src/lib/api.ts).
 * In dev, Vite's proxy forwards that to the backend (see vite.config.ts). In
 * prod there is no Vite, so this adapter-node server forwards `/api/*` to the
 * backend itself — giving one public origin (the frontend), letting the backend
 * stay on internal ingress, and avoiding CORS entirely.
 *
 * BACKEND_ORIGIN points at the backend (compose: http://backend:8080; Container
 * Apps: the backend app's internal FQDN). Defaults to localhost for `node build`.
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? 'http://localhost:8080';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api')) {
    const target = BACKEND_ORIGIN + event.url.pathname + event.url.search;

    const headers = new Headers(event.request.headers);
    headers.delete('host'); // let fetch set the correct upstream Host

    const method = event.request.method;
    const res = await fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : await event.request.arrayBuffer(),
      redirect: 'manual',
    });

    // undici decompresses the upstream body when we stream res.body, so the
    // original content-encoding/length no longer describe these bytes — drop them.
    const outHeaders = new Headers(res.headers);
    outHeaders.delete('content-encoding');
    outHeaders.delete('content-length');

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders });
  }

  return resolve(event);
};

import { Router } from 'express';
import { currentOrg } from './routes.js';

// Public, unauthenticated logo endpoint so EMAIL clients (which block data: URIs
// and can't send auth headers) can load the church logo over plain https. The
// logo is a public brand asset. Serves the stored logo whether it's a data: URI
// (decoded to bytes) or an external URL (redirect).
export const publicBrandingRouter = Router();

publicBrandingRouter.get('/logo', async (_req, res) => {
  try {
    const org = await currentOrg();
    const lp = (org as { logoPath?: string | null }).logoPath;
    if (!lp) return res.status(404).end();
    if (/^https?:\/\//i.test(lp)) return res.redirect(302, lp);
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(lp);
    if (!m) return res.status(404).end();
    const buf = Buffer.from(m[2], 'base64');
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buf);
  } catch {
    return res.status(404).end();
  }
});

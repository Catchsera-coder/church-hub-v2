import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { media } from '../../db/schema.js';
import { config } from '../../config.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024; // MMS limit

// Authenticated upload: stores an image and returns its public URL.
export const mediaRouter = Router();
mediaRouter.use(authenticate);

const uploadSchema = z.object({ base64: z.string().max(8_000_000), contentType: z.string().max(100), filename: z.string().max(190).optional() });

mediaRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = uploadSchema.parse(req.body);
  if (!ALLOWED.has(b.contentType)) throw badRequest('Only JPEG, PNG or GIF images are allowed.');
  const data = b.base64.replace(/^data:[^,]+,/, '');
  if (Buffer.byteLength(data, 'base64') > MAX_BYTES) throw badRequest('Image must be under 5 MB.');
  const [row] = await db.insert(media).values({ contentType: b.contentType, filename: b.filename ?? null, data }).returning();
  const appUrl = (config.PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  res.status(201).json({ data: { token: row!.token, url: `${appUrl}/api/public/media/${row!.token}` } });
}));

// Public serve (Twilio must be able to fetch it without auth).
export const publicMediaRouter = Router();
publicMediaRouter.get('/:token', asyncHandler(async (req, res) => {
  const [row] = await db.select().from(media).where(eq(media.token, req.params.token)).limit(1);
  if (!row) throw notFound('Not found.');
  res.setHeader('Content-Type', row.contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(row.data, 'base64'));
}));

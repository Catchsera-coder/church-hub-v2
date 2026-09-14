import { Router } from 'express';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { messageAttachments } from '../../db/schema.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../http/errors.js';
import {
  blobConfigured, blobUploadUrl, blobDownloadUrl, newBlobName, putBytes, deleteBytes, DB_FALLBACK_MAX_BYTES,
} from '../../lib/storage.js';

/**
 * Message attachments (any file type/size). Two upload paths:
 *  1) /blob-url  — direct-to-Blob: reserve a blob + return a write-only signed
 *     URL the browser PUTs the file straight to (handles any size). Used when
 *     Azure Blob is configured.
 *  2) /          — base64 through the API. Used as the fallback before Blob is
 *     set up (small files), or for tiny files. Bytes go to Blob when configured,
 *     else the database.
 */
export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);

const META_MAX = 1024 * 1024 * 1024; // 1 GB sanity cap on the declared size

// 1) Direct-to-Blob upload URL.
attachmentsRouter.post('/blob-url', requirePermission('create message'), asyncHandler(async (req, res) => {
  if (!blobConfigured()) throw badRequest('blob_not_configured');
  const b = z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().max(150).default('application/octet-stream'),
    size: z.number().int().nonnegative().max(META_MAX).default(0),
  }).parse(req.body);
  const blobName = newBlobName(b.filename);
  const uploadUrl = await blobUploadUrl(blobName, b.contentType);
  if (!uploadUrl) throw badRequest('blob_not_configured');
  const [row] = await db.insert(messageAttachments).values({
    filename: b.filename, contentType: b.contentType, sizeBytes: b.size,
    storage: 'blob', blobName, uploadedByUserId: req.auth!.sub,
  }).returning();
  res.status(201).json({ data: { token: row!.token, uploadUrl } });
}));

// 2) Base64 upload (Blob when configured, else DB fallback).
attachmentsRouter.post('/', requirePermission('create message'), asyncHandler(async (req, res) => {
  const b = z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().max(150).default('application/octet-stream'),
    base64: z.string().min(1),
  }).parse(req.body);
  const raw = b.base64.replace(/^data:[^,]+,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw badRequest('Empty file.');
  if (!blobConfigured() && buf.length > DB_FALLBACK_MAX_BYTES) {
    throw badRequest(`This file is ${(buf.length / 1048576).toFixed(1)} MB. Until cloud file storage (Azure Blob) is configured, attachments must be under ${Math.floor(DB_FALLBACK_MAX_BYTES / 1048576)} MB.`);
  }
  const stored = await putBytes(buf, b.contentType, b.filename);
  const [row] = await db.insert(messageAttachments).values({
    filename: b.filename, contentType: b.contentType, sizeBytes: buf.length,
    storage: stored.storage, blobName: stored.blobName ?? null, data: stored.data ?? null,
    uploadedByUserId: req.auth!.sub,
  }).returning();
  res.status(201).json({ data: { token: row!.token, filename: row!.filename, contentType: row!.contentType, sizeBytes: row!.sizeBytes } });
}));

// List metadata for a set of tokens (composer) or a campaign (detail page).
attachmentsRouter.get('/', requirePermission('view message'), asyncHandler(async (req, res) => {
  const tokens = String(req.query.tokens ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  const where = campaignId ? eq(messageAttachments.campaignId, campaignId)
    : tokens.length ? inArray(messageAttachments.token, tokens) : null;
  if (!where) { res.json({ data: [] }); return; }
  const rows = await db
    .select({ token: messageAttachments.token, filename: messageAttachments.filename, contentType: messageAttachments.contentType, sizeBytes: messageAttachments.sizeBytes })
    .from(messageAttachments).where(where);
  res.json({ data: rows });
}));

attachmentsRouter.delete('/:token', requirePermission('create message'), asyncHandler(async (req, res) => {
  const [row] = await db.select().from(messageAttachments).where(eq(messageAttachments.token, req.params.token)).limit(1);
  if (!row) throw notFound();
  await deleteBytes(row);
  await db.delete(messageAttachments).where(eq(messageAttachments.id, row.id));
  res.json({ data: { ok: true } });
}));

/**
 * Public download — recipients aren't authenticated. Blob files 302-redirect to a
 * fresh short-lived signed URL (so the link in an old email still works, but the
 * underlying signed URL is never long-lived); DB-fallback files stream directly.
 * The unguessable UUID token is the access control (same model as media).
 */
export const publicAttachmentsRouter = Router();
publicAttachmentsRouter.get('/:token', asyncHandler(async (req, res) => {
  const [row] = await db.select().from(messageAttachments).where(eq(messageAttachments.token, req.params.token)).limit(1);
  if (!row) throw notFound('Not found.');
  if (row.storage === 'blob' && row.blobName) {
    const url = await blobDownloadUrl(row.blobName, row.filename, row.contentType);
    if (!url) throw notFound('Not found.');
    res.redirect(302, url);
    return;
  }
  if (row.data) {
    res.setHeader('Content-Type', row.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/[\r\n"]/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(row.data, 'base64'));
    return;
  }
  throw notFound('Not found.');
}));

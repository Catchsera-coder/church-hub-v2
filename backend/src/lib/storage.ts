import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/**
 * Attachment storage. Files (any type/size) live in Azure Blob Storage when it's
 * configured (AZURE_STORAGE_CONNECTION_STRING) — uploads go straight to Blob via
 * a short-lived signed URL, downloads via a signed read URL, so bytes never sit
 * in the DB or stream through the API. When Blob is NOT configured, small files
 * fall back to the database (base64) so the feature still works before the
 * Storage account is provisioned.
 *
 * The @azure SDK is imported lazily so the app boots fine on deploys that don't
 * use Blob.
 */

export function blobConfigured(): boolean {
  return Boolean(config.AZURE_STORAGE_CONNECTION_STRING);
}

// Cap for the DB fallback path (base64 through the API). Blob has no such cap.
export const DB_FALLBACK_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

let containerPromise: Promise<any> | null = null;
async function getContainer(): Promise<any | null> {
  if (!config.AZURE_STORAGE_CONNECTION_STRING) return null;
  if (!containerPromise) {
    containerPromise = (async () => {
      const { BlobServiceClient } = await import('@azure/storage-blob');
      const svc = BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING!);
      const container = svc.getContainerClient(config.AZURE_STORAGE_CONTAINER);
      // Private container (no public access) — access is only ever via signed URLs.
      await container.createIfNotExists();
      return container;
    })().catch((err) => {
      containerPromise = null; // let a later call retry after a transient failure
      throw err;
    });
  }
  return containerPromise;
}

/** A safe, unique blob name that keeps the original extension. */
export function newBlobName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
  const day = new Date().toISOString().slice(0, 10);
  return `${day}/${randomUUID()}${ext}`;
}

/**
 * A write-only signed URL the browser PUTs the file to directly (any size).
 * Returns null when Blob isn't configured (caller then uses the DB fallback).
 */
export async function blobUploadUrl(blobName: string, contentType: string, ttlMinutes = 30): Promise<string | null> {
  const container = await getContainer();
  if (!container) return null;
  const blob = container.getBlockBlobClient(blobName);
  const expiresOn = new Date(Date.now() + ttlMinutes * 60_000);
  const { BlobSASPermissions } = await import('@azure/storage-blob');
  return blob.generateSasUrl({ permissions: BlobSASPermissions.parse('cw'), expiresOn, contentType });
}

/**
 * A short-lived signed read URL for a recipient to download the file, with the
 * original filename attached. Recipients aren't authenticated, so links are
 * generated fresh (short TTL) on each click via the public download route.
 */
export async function blobDownloadUrl(blobName: string, filename: string, contentType: string, ttlMinutes = 120): Promise<string | null> {
  const container = await getContainer();
  if (!container) return null;
  const blob = container.getBlockBlobClient(blobName);
  const expiresOn = new Date(Date.now() + ttlMinutes * 60_000);
  const { BlobSASPermissions } = await import('@azure/storage-blob');
  const safe = filename.replace(/[\r\n"]/g, '').slice(0, 180);
  return blob.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    expiresOn,
    contentType,
    contentDisposition: `attachment; filename="${safe}"`,
  });
}

/** Store bytes: Blob when configured, else the DB fallback (base64). */
export async function putBytes(buf: Buffer, contentType: string, filename: string): Promise<{ storage: 'blob' | 'db'; blobName?: string; data?: string }> {
  const container = await getContainer();
  if (container) {
    const blobName = newBlobName(filename);
    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
    return { storage: 'blob', blobName };
  }
  return { storage: 'db', data: buf.toString('base64') };
}

/** Read the raw bytes back (used to attach inline to email, and DB downloads). */
export async function getBytes(a: { storage: string; blobName?: string | null; data?: string | null }): Promise<Buffer | null> {
  if (a.storage === 'blob' && a.blobName) {
    const container = await getContainer();
    if (!container) return null;
    const blob = container.getBlockBlobClient(a.blobName);
    return blob.downloadToBuffer();
  }
  if (a.data) return Buffer.from(a.data, 'base64');
  return null;
}

/** Best-effort delete of the stored bytes (metadata row is removed separately). */
export async function deleteBytes(a: { storage: string; blobName?: string | null }): Promise<void> {
  if (a.storage === 'blob' && a.blobName) {
    try {
      const container = await getContainer();
      if (container) await container.getBlockBlobClient(a.blobName).deleteIfExists();
    } catch (err) {
      console.error('[storage] blob delete failed:', err instanceof Error ? err.message : err);
    }
  }
}

import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Multi-factor auth primitives — dependency-free (Node crypto only).
 * - TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s step) for authenticator apps.
 * - Recovery/backup codes (shown once, only SHA-256 hashes stored).
 * - AES-256-GCM at-rest encryption for the TOTP secret. The key is derived from
 *   JWT_ACCESS_SECRET via scrypt, so no new env var is required and the raw
 *   secret is never stored in plaintext.
 */

// --- base32 (RFC 4648, no padding) — TOTP secrets are base32 ---------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/,'').replace(/\s/g,'').toUpperCase();
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// --- TOTP ------------------------------------------------------------------
/** A fresh base32 TOTP secret (160-bit, per RFC recommendation). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}
function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
/** Verify a 6-digit code with a ±1 step window (clock skew tolerance). */
export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  const t = (token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    // constant-time compare against each candidate
    const cand = hotp(secretB32, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(cand), Buffer.from(t))) return true;
  }
  return false;
}
/** otpauth:// URI the authenticator app encodes as a QR. */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Recovery codes --------------------------------------------------------
/** 10 human-friendly one-time codes (e.g. "3f9k-x2mq"). Returned once. */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars
  const one = () => Array.from(crypto.randomBytes(8)).map((b) => alphabet[b % alphabet.length]).join('');
  return Array.from({ length: n }, () => { const s = one(); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; });
}
export const hashRecoveryCode = (code: string): string =>
  crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

// --- AES-256-GCM at-rest encryption for the TOTP secret --------------------
const encKey = crypto.scryptSync(config.JWT_ACCESS_SECRET, 'churchhub-mfa-enc-v1', 32);
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
}
export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored.replace(/^v1:/, ''), 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Transparent, backward-compatible helpers for at-rest secret storage:
// encryptMaybe leaves already-encrypted ("v1:") or empty values alone; decryptMaybe
// returns legacy plaintext (pre-encryption rows) untouched. This lets us encrypt
// on write and decrypt on read without a migration and without breaking old data.
export function encryptMaybe<T extends string | null | undefined>(v: T): T {
  return (v && typeof v === 'string' && !v.startsWith('v1:') ? (encryptSecret(v) as T) : v);
}
export function decryptMaybe<T extends string | null | undefined>(v: T): T {
  if (!v || typeof v !== 'string' || !v.startsWith('v1:')) return v;
  try { return decryptSecret(v) as T; } catch { return v; }
}

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AccessClaims {
  sub: number;
  email: string;
  roles: string[];
  perms: string[];
}

export const signAccessToken = (claims: AccessClaims): string =>
  jwt.sign(claims, config.JWT_ACCESS_SECRET, { expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] });

export const verifyAccessToken = (token: string): AccessClaims =>
  jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessClaims;

// Refresh tokens are opaque random strings; only their SHA-256 hash is stored,
// so a DB leak can't be used to mint access tokens. Rotated on every refresh.
export const newRefreshToken = (): { token: string; hash: string } => {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
};

export const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

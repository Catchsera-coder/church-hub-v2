import argon2 from 'argon2';

// Argon2id with pinned parameters (OWASP-aligned: 64 MiB, 3 passes) so the work
// factor can't silently drift if the library's defaults change. Verify reads the
// params from each stored hash, so existing hashes keep working.
export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

export const verifyPassword = async (hash: string | null | undefined, plain: string): Promise<boolean> => {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};

// Burn an equivalent Argon2 verify when there is no real hash to check, so
// login timing doesn't reveal whether an account exists (user enumeration).
let dummyHash: string | null = null;
export const equalizeVerify = async (plain: string): Promise<void> => {
  try {
    if (!dummyHash) dummyHash = await hashPassword('argon2-timing-equalizer');
    await argon2.verify(dummyHash, plain);
  } catch { /* ignore — this call only exists to spend comparable time */ }
};

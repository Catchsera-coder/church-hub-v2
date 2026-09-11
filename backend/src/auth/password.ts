import argon2 from 'argon2';

// Minimum password policy, enforced everywhere a password is set (reset, change,
// invite accept, admin set). NIST-aligned: length over complexity rules, block
// the obvious weak/common choices, and don't allow the person's own name/email.
const MIN_LENGTH = 10;
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '1234567890', '12345678', '123456789',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein123', 'welcome123', 'admin123', 'changeme',
  'changeme!12345', 'church123', 'jesus123', 'god12345', 'abcd1234', 'test1234', 'baptist123',
]);
export function passwordIssue(pw: string, ctx?: { email?: string | null; name?: string | null }): string | null {
  if (!pw || pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  const low = pw.toLowerCase();
  if (COMMON.has(low)) return 'That password is too common — please choose something harder to guess.';
  const local = ctx?.email?.toLowerCase().split('@')[0];
  if (local && local.length >= 3 && low.includes(local)) return 'Please don’t include your email in your password.';
  const name = ctx?.name?.toLowerCase().trim();
  if (name && name.length >= 3 && low.includes(name)) return 'Please don’t include your name in your password.';
  return null;
}

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

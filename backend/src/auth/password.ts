import argon2 from 'argon2';

// Argon2id — modern default, stronger than bcrypt. Passwords are never stored plain.
export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, { type: argon2.argon2id });

export const verifyPassword = async (hash: string | null | undefined, plain: string): Promise<boolean> => {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};

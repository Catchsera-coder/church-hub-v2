import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalise a phone number to clean international form (E.164, e.g. +16175551234)
 * whenever it's a valid number, so SMS/WhatsApp always work. This is the server
 * guarantee: it runs on every write (forms, import, API) and on the one-time
 * backfill of existing data.
 *  - empty / no digits        → null (stored blank)
 *  - valid number             → E.164 ("+…")
 *  - has digits but not valid → cleaned digits (never destroy a real attempt)
 * Default country US; a value starting with "+" is treated as international.
 */
export function normalizePhone(input: string | null | undefined, country: CountryCode = 'US'): string | null {
  const v = (input ?? '').trim();
  if (!v) return null;
  const parsed = parsePhoneNumberFromString(v, v.startsWith('+') ? undefined : country);
  if (parsed?.isValid()) return parsed.number;
  const cleaned = v.replace(/[^\d+]/g, '');
  return cleaned || null;
}

/** True when the value is already a valid E.164 number (nothing to fix). */
export function isNormalized(v: string | null | undefined): boolean {
  if (!v) return true;
  const p = parsePhoneNumberFromString(v);
  return !!p?.isValid() && p.number === v;
}

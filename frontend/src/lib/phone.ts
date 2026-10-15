import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalise a typed phone number to the clean international form (E.164, e.g.
 * +16175551234) when it's a valid number, so SMS/WhatsApp always work. A number
 * that isn't yet valid is kept as cleaned digits (+ allowed) so nothing is lost.
 * Default country is the US; a value starting with "+" is treated as international.
 */
export function normalizePhone(input: string | null | undefined, country: CountryCode = 'US'): string {
  const v = (input ?? '').trim();
  if (!v) return '';
  const p = parsePhoneNumberFromString(v, v.startsWith('+') ? undefined : country);
  return p?.isValid() ? p.number : v.replace(/[^\d+]/g, '');
}

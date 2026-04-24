/**
 * Normalise a Mexican phone number to bare digit-only E.164 form (no '+').
 *
 * Handles:
 *   - 10-digit national number → prepends MX country code (52)
 *   - 13-digit legacy mobile-prefix: 521XXXXXXXXXX → 52XXXXXXXXXX
 *   - Already-formatted 12-digit 52XXXXXXXXXX → unchanged
 *   - Free-form input with spaces, dashes, parens, '+' → stripped to digits
 *
 * Non-Mexican numbers are passed through after stripping non-digits; the caller
 * is responsible for deciding what to do with them. The consuming form enforces
 * MX format via Zod, so this is defensive rather than authoritative.
 */
export function normaliseMexicanPhone(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  if (digits.length === 10) {
    digits = '52' + digits;
  }
  return digits;
}

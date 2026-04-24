/**
 * CSV helpers for the Meta Custom Audiences export.
 *
 * Meta's audience uploader accepts either plain-text or SHA-256-hashed inputs
 * for phone/fn/ln. We export plain text since the file is already treated as
 * sensitive data and Meta hashes on ingest. Phone alone is a strong match
 * when email isn't captured.
 */

export const META_AUDIENCE_HEADERS = ['phone', 'fn', 'ln', 'email', 'country'] as const;

export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Split a full name into first/last on the first space. Everything after the
 * first space becomes the last name (handles "Juan Carlos García" cleanly
 * without assuming surname-is-one-word).
 */
export function splitName(full: string): { fn: string; ln: string } {
  const trimmed = full.trim();
  if (!trimmed) return { fn: '', ln: '' };
  const space = trimmed.indexOf(' ');
  if (space === -1) return { fn: trimmed, ln: '' };
  return { fn: trimmed.slice(0, space), ln: trimmed.slice(space + 1).trim() };
}

interface GuestRow {
  name: string;
  whatsapp: string;
}

/**
 * Serialise guest rows to a Meta Custom Audiences CSV string.
 * whatsapp is assumed pre-normalised (digits only, 52-prefixed). A '+' is
 * prepended on output so Meta treats the value as E.164.
 */
export function guestsToMetaCsv(rows: GuestRow[]): string {
  const lines: string[] = [META_AUDIENCE_HEADERS.join(',')];
  for (const row of rows) {
    const { fn, ln } = splitName(row.name);
    const phone = row.whatsapp.startsWith('+') ? row.whatsapp : `+${row.whatsapp}`;
    lines.push([phone, fn, ln, '', 'mx'].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

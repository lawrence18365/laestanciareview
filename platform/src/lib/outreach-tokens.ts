import { timingSafeEqual } from './timing';

const SECRET = process.env.SESSION_SECRET;

/**
 * Derive an unsubscribe token for a prospect from SESSION_SECRET.
 * Returns a url-safe hex string: HMAC-SHA256(id, SECRET).
 */
export async function makeUnsubscribeToken(prospectId: number): Promise<string> {
  if (!SECRET) throw new Error('SESSION_SECRET is not configured');
  const key = await importHmacKey(SECRET);
  const data = new TextEncoder().encode(String(prospectId));
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return arrayBufferToHex(signature);
}

/**
 * Constant-time verify an unsubscribe token.
 * Always returns a boolean; never throws on malformed input.
 */
export async function verifyUnsubscribeToken(
  prospectId: number,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || !SECRET) return false;
  try {
    const expected = await makeUnsubscribeToken(prospectId);
    return timingSafeEqual(expected, token);
  } catch {
    return false;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

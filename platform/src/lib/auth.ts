import { NextRequest } from 'next/server';
import { timingSafeEqual } from './timing';

/**
 * Check the request carries a valid admin API key.
 * Expects header: `x-api-key: <ADMIN_API_KEY>`
 */
export function requireAdminKey(req: NextRequest): boolean {
  const key = req.headers.get('x-api-key');
  if (!key || !process.env.ADMIN_API_KEY) return false;
  return timingSafeEqual(key, process.env.ADMIN_API_KEY);
}

/**
 * Hash a password using PBKDF2 with a random salt.
 * Format: salt:iterations:hash (all hex-encoded).
 */
export async function hashPassword(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );

  const saltHex = toHex(new Uint8Array(salt));
  const hashHex = toHex(new Uint8Array(derivedBits));
  return `${saltHex}:${iterations}:${hashHex}`;
}

export async function verifyPassword(
  plain: string,
  storedHash: string,
): Promise<boolean> {
  // Support legacy unsalted SHA-256 hashes (64 hex chars, no colons)
  if (!storedHash.includes(':')) {
    return await verifyLegacyPassword(plain, storedHash);
  }

  const [saltHex, iterStr, expectedHash] = storedHash.split(':');
  const encoder = new TextEncoder();
  const salt = fromHex(saltHex);
  const iterations = parseInt(iterStr, 10);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );

  const computedHash = toHex(new Uint8Array(derivedBits));
  return timingSafeEqual(computedHash, expectedHash);
}

/**
 * Verify against legacy SHA-256 hash (no salt). Used for migration only.
 */
async function verifyLegacyPassword(plain: string, hash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const computed = toHex(new Uint8Array(hashBuffer));
  return timingSafeEqual(computed, hash);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Return a 401 JSON response for unauthorized requests.
 */
export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

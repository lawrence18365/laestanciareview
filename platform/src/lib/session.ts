import { cookies } from 'next/headers';

const COOKIE_NAME = 'ratetap_session';
const SEVEN_DAYS = 7 * 24 * 60 * 60; // seconds

export type SessionRole = 'gm' | 'owner' | 'regional';

export interface SessionData {
  slug: string;
  role: SessionRole;
  region?: string;
}

/**
 * Derive a session-specific signing key from ADMIN_API_KEY.
 * This ensures the session secret is distinct from the API key itself.
 */
async function getSigningKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET ?? process.env.ADMIN_API_KEY;
  if (!secret) throw new Error('SESSION_SECRET or ADMIN_API_KEY must be set');

  const encoder = new TextEncoder();
  // Derive a session-specific key using HKDF-like approach
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // Sign a fixed context string to derive a separate key
  const derived = await crypto.subtle.sign(
    'HMAC',
    baseKey,
    encoder.encode('ratetap-session-signing-v1'),
  );
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** HMAC-SHA256 sign a message with the derived session key. */
async function hmacSign(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a signed session cookie.
 * Cookie value: slug:role:expiry_unix:hmac  OR  slug:role:region:expiry_unix:hmac
 */
export async function createSession(slug: string, role: SessionRole = 'gm', region?: string): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) + SEVEN_DAYS;
  const payload = region ? `${slug}:${role}:${region}:${expiry}` : `${slug}:${role}:${expiry}`;
  const hmac = await hmacSign(payload);
  const value = `${payload}:${hmac}`;

  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SEVEN_DAYS,
  });
}

/**
 * Verify the session cookie and return { slug, role }, or null if invalid.
 */
export async function verifySession(): Promise<SessionData | null> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return parseSession(cookie);
}

/**
 * Clear the session cookie.
 */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/**
 * Parse and verify a raw cookie value (for middleware).
 * Returns { slug, role } if valid, null otherwise.
 */
export async function verifySessionValue(value: string): Promise<SessionData | null> {
  return parseSession(value);
}

async function parseSession(cookie: string): Promise<SessionData | null> {
  const parts = cookie.split(':');

  // Support both old format (slug:expiry:hmac) and new (slug:role:expiry:hmac)
  if (parts.length === 3) {
    // Legacy format: slug:expiry:hmac — treat as gm
    const [slug, expiryStr, hmac] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry)) return null;
    if (Math.floor(Date.now() / 1000) > expiry) return null;
    const expected = await hmacSign(`${slug}:${expiryStr}`);
    if (hmac !== expected) return null;
    return { slug, role: 'gm' };
  }

  if (parts.length === 4) {
    const [slug, role, expiryStr, hmac] = parts;
    if (role !== 'gm' && role !== 'owner') return null;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry)) return null;
    if (Math.floor(Date.now() / 1000) > expiry) return null;
    const expected = await hmacSign(`${slug}:${role}:${expiryStr}`);
    if (hmac !== expected) return null;
    return { slug, role: role as SessionRole };
  }

  // 5-part format: slug:role:region:expiry:hmac (regional managers)
  if (parts.length === 5) {
    const [slug, role, region, expiryStr, hmac] = parts;
    if (role !== 'regional') return null;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry)) return null;
    if (Math.floor(Date.now() / 1000) > expiry) return null;
    const expected = await hmacSign(`${slug}:${role}:${region}:${expiryStr}`);
    if (hmac !== expected) return null;
    return { slug, role: 'regional', region };
  }

  return null;
}

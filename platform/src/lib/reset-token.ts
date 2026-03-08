const ONE_HOUR = 60 * 60; // seconds

async function getResetSigningKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET must be set');

  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derived = await crypto.subtle.sign(
    'HMAC',
    baseKey,
    encoder.encode('ratetap-password-reset-v1'),
  );
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function hmacSign(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await getResetSigningKey();
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate an HMAC-signed password reset token.
 * Format: slug:expiry_unix:hmac (URL-safe base64 encoded)
 */
export async function generateResetToken(slug: string): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ONE_HOUR;
  const payload = `${slug}:${expiry}`;
  const hmac = await hmacSign(payload);
  const token = `${payload}:${hmac}`;
  return Buffer.from(token).toString('base64url');
}

/**
 * Verify a reset token and return the slug if valid.
 * Returns null if expired or tampered with.
 */
export async function verifyResetToken(token: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString();
  } catch {
    return null;
  }

  const parts = decoded.split(':');
  if (parts.length !== 3) return null;

  const [slug, expiryStr, hmac] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry)) return null;
  if (Math.floor(Date.now() / 1000) > expiry) return null;

  const expected = await hmacSign(`${slug}:${expiryStr}`);
  if (hmac !== expected) return null;

  return slug;
}

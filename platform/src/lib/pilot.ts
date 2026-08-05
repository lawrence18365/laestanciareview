import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PILOT_TRIAL_DAYS = 30;
export const PILOT_REDEMPTION_LIMIT = 5;
export const PILOT_ACCESS_COOKIE = 'ratetap_pilot_access';
export const PILOT_ACCESS_TTL_SECONDS = 30 * 60;

export function isValidPilotCode(candidate: string | null | undefined): boolean {
  const expected = process.env.PILOT_CODE;
  if (candidate == null || !expected) return false;

  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function createPilotAccessToken(now = Date.now()): string | null {
  const secret = pilotAccessSecret();
  if (!secret) return null;

  const expiresAt = Math.floor(now / 1000) + PILOT_ACCESS_TTL_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export function isValidPilotAccessToken(token: string | null | undefined, now = Date.now()): boolean {
  const secret = pilotAccessSecret();
  if (!token || !secret) return false;

  const [version, expiresAtRaw, signature, ...extra] = token.split('.');
  if (version !== 'v1' || !expiresAtRaw || !signature || extra.length > 0) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(now / 1000)) return false;

  const payload = `${version}.${expiresAtRaw}`;
  const actualDigest = createHash('sha256').update(signature).digest();
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedDigest = createHash('sha256').update(expectedSignature).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function pilotAccessSecret(): string | null {
  const pilotCode = process.env.PILOT_CODE;
  const sessionSecret = process.env.SESSION_SECRET;
  return pilotCode && sessionSecret ? `${sessionSecret}:ratetap-pilot-access-v1:${pilotCode}` : null;
}

import { timingSafeEqual } from './timing';

export function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return toHex(values);
}

export async function tokenHash(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(hash));
}

export async function verifyTokenHash(token: string, expectedHash: string): Promise<boolean> {
  const actualHash = await tokenHash(token);
  return timingSafeEqual(actualHash, expectedHash);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

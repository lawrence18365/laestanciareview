import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth';

describe('hashPassword', () => {
  it('returns a string in salt:iterations:hash format', async () => {
    const hash = await hashPassword('mypassword');
    const parts = hash.split(':');
    expect(parts).toHaveLength(3);
    // salt = 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // iterations
    expect(parts[1]).toBe('100000');
    // hash = 256 bits = 32 bytes = 64 hex chars
    expect(parts[2]).toHaveLength(64);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('samepassword');
    const hash2 = await hashPassword('samepassword');
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-horse', hash)).toBe(false);
  });

  it('handles legacy unsalted SHA-256 hashes (no colons)', async () => {
    // SHA-256 of "legacy" = pre-computed
    const encoder = new TextEncoder();
    const data = encoder.encode('legacy');
    const buf = await crypto.subtle.digest('SHA-256', data);
    const legacyHash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(await verifyPassword('legacy', legacyHash)).toBe(true);
    expect(await verifyPassword('wrong', legacyHash)).toBe(false);
  });
});

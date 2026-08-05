import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('outreach unsubscribe tokens', () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-outreach-tokens';
  });

  afterAll(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  async function loadTokens() {
    // Dynamic import so the module reads the freshly-set SESSION_SECRET.
    const mod = await import('@/lib/outreach-tokens');
    return mod;
  }

  it('round-trips a valid token', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await loadTokens();
    const token = await makeUnsubscribeToken(42);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyUnsubscribeToken(42, token)).toBe(true);
  });

  it('rejects a token for a different prospect id', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await loadTokens();
    const token = await makeUnsubscribeToken(42);
    expect(await verifyUnsubscribeToken(99, token)).toBe(false);
  });

  it('rejects a tampered token', async () => {
    const { makeUnsubscribeToken, verifyUnsubscribeToken } = await loadTokens();
    const token = await makeUnsubscribeToken(42);
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
    expect(await verifyUnsubscribeToken(42, tampered)).toBe(false);
  });

  it('rejects missing or empty tokens', async () => {
    const { verifyUnsubscribeToken } = await loadTokens();
    expect(await verifyUnsubscribeToken(42, null)).toBe(false);
    expect(await verifyUnsubscribeToken(42, undefined)).toBe(false);
    expect(await verifyUnsubscribeToken(42, '')).toBe(false);
  });

  it('produces different tokens for different ids', async () => {
    const { makeUnsubscribeToken } = await loadTokens();
    const t1 = await makeUnsubscribeToken(1);
    const t2 = await makeUnsubscribeToken(2);
    expect(t1).not.toBe(t2);
  });
});

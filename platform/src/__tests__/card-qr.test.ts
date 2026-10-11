import { describe, it, expect, afterEach } from 'vitest';
import { cardUrlFor } from '@/lib/qr';

const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl;
});

describe('cardUrlFor', () => {
  it('falls back to the production base URL when NEXT_PUBLIC_BASE_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(cardUrlFor('estancia-leon', 'JUANCARLOS')).toBe(
      'https://app.ratetapmx.com/r/estancia-leon?card=JUANCARLOS',
    );
  });

  it('round-trips the card code through the query string', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    for (const code of ['K12', 'JUANCARLOS2']) {
      const url = new URL(cardUrlFor('estancia-leon', code));
      expect(url.searchParams.get('card')).toBe(code);
    }
  });
});

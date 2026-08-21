import { describe, it, expect, beforeAll } from 'vitest';

// The module under test transitively imports @/db, which reads DATABASE_URL
// at module load. Follow the established pattern (see product-events.test.ts):
// stub the env var, then dynamic-import inside beforeAll. These tests only
// exercise the pure helpers — no query ever runs.
let pa: typeof import('@/lib/product-analytics');

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  pa = await import('@/lib/product-analytics');
});

describe('tag', () => {
  it('attaches the integrity tag to the value', () => {
    expect(pa.tag(42, 'verified')).toEqual({ value: 42, tag: 'verified' });
    expect(pa.tag('x', 'reported')).toEqual({ value: 'x', tag: 'reported' });
    expect(pa.tag(null, 'inferred')).toEqual({ value: null, tag: 'inferred' });
  });
});

describe('pct', () => {
  it('computes percentages with one decimal', () => {
    expect(pa.pct(1, 3)).toBe(33.3);
    expect(pa.pct(1, 2)).toBe(50);
    expect(pa.pct(3, 4)).toBe(75);
  });

  it('returns 0 when the denominator is 0', () => {
    expect(pa.pct(0, 0)).toBe(0);
    expect(pa.pct(5, 0)).toBe(0);
  });

  it('returns 0 for non-finite input', () => {
    expect(pa.pct(Number.NaN, 10)).toBe(0);
    expect(pa.pct(5, Number.NaN)).toBe(0);
  });
});

describe('rateOrNull (bookingRate / revenuePerContact math)', () => {
  it('returns the ratio when the denominator is positive', () => {
    expect(pa.rateOrNull(3, 100)).toBe(0.03);
    expect(pa.rateOrNull(1500, 60)).toBe(25);
  });

  it('returns null when the audience is 0 (undefined, not 0)', () => {
    expect(pa.rateOrNull(0, 0)).toBeNull();
    expect(pa.rateOrNull(500, 0)).toBeNull();
  });
});

describe('adoptionState thresholds', () => {
  it('is unused with 0 active days', () => {
    expect(pa.adoptionState(0)).toBe('unused');
  });

  it('is occasional with 1–7 active days', () => {
    expect(pa.adoptionState(1)).toBe('occasional');
    expect(pa.adoptionState(7)).toBe('occasional');
  });

  it('is active with 8 or more active days', () => {
    expect(pa.adoptionState(8)).toBe('active');
    expect(pa.adoptionState(30)).toBe('active');
  });
});

describe('funnelConversion', () => {
  it('computes the % between consecutive steps', () => {
    expect(pa.funnelConversion(100, 40)).toBe(40);
    expect(pa.funnelConversion(3, 1)).toBe(33.3);
  });

  it('returns null when the previous step is 0', () => {
    expect(pa.funnelConversion(0, 0)).toBeNull();
    expect(pa.funnelConversion(0, 5)).toBeNull();
  });

  it('can exceed 100% (steps are independent counts)', () => {
    expect(pa.funnelConversion(2, 5)).toBe(250);
  });
});

import { describe, it, expect } from 'vitest';
import { normaliseMexicanPhone } from '@/lib/phone';

describe('normaliseMexicanPhone', () => {
  it('prepends MX country code to a bare 10-digit number', () => {
    expect(normaliseMexicanPhone('5512345678')).toBe('525512345678');
  });

  it('strips the legacy "1" after the country code in 13-digit form', () => {
    expect(normaliseMexicanPhone('5215512345678')).toBe('525512345678');
  });

  it('passes through an already-normalised 12-digit number', () => {
    expect(normaliseMexicanPhone('525512345678')).toBe('525512345678');
  });

  it('strips spaces, dashes, parens, and plus from free-form input', () => {
    expect(normaliseMexicanPhone('+52 (55) 1234-5678')).toBe('525512345678');
    expect(normaliseMexicanPhone('55 1234 5678')).toBe('525512345678');
    expect(normaliseMexicanPhone('(55) 1234-5678')).toBe('525512345678');
  });

  it('strips letters (safety net for invalid input from the form)', () => {
    // 12 digits after stripping → already-normalised form, no rules apply.
    expect(normaliseMexicanPhone('52 55 abc 1234 5678')).toBe('525512345678');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseMexicanPhone('')).toBe('');
  });

  it('does not mangle non-MX numbers that are already long enough', () => {
    // 11-digit US form "15551234567" stays as-is (no 52 prefix, no legacy strip)
    expect(normaliseMexicanPhone('15551234567')).toBe('15551234567');
  });

  it('is idempotent', () => {
    const once = normaliseMexicanPhone('+52 55 1234 5678');
    const twice = normaliseMexicanPhone(once);
    expect(twice).toBe(once);
  });

  it('dedup consistency: visually different inputs → identical output', () => {
    // Critical property: dedup on (whatsapp, brand) relies on this.
    const a = normaliseMexicanPhone('+52 55 1234 5678');
    const b = normaliseMexicanPhone('(55) 1234-5678');
    const c = normaliseMexicanPhone('5215512345678');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

import { describe, it, expect } from 'vitest';
import { makeCode } from '@/lib/staff-code';

describe('makeCode', () => {
  it('converts a name to uppercase letters only', () => {
    const used = new Set<string>();
    expect(makeCode('JUAN CARLOS', used)).toBe('JUANCARLOS');
  });

  it('strips accented characters', () => {
    const used = new Set<string>();
    expect(makeCode('ALFONSO PEÑA', used)).toBe('ALFONSOPENA');
  });

  it('removes punctuation and numbers', () => {
    const used = new Set<string>();
    // The regex strips non-alpha chars, so "3" is removed but "rd" stays
    expect(makeCode("JOSE-MARIA O'BRIEN 3rd", used)).toBe('JOSEMARIAOBRIENRD');
  });

  it('appends a numeric suffix on duplicate codes', () => {
    const used = new Set<string>();
    const first = makeCode('LUIS ANGEL', used);
    expect(first).toBe('LUISANGEL');

    const second = makeCode('LUIS ANGEL', used);
    expect(second).toBe('LUISANGEL2');

    const third = makeCode('LUIS ANGEL', used);
    expect(third).toBe('LUISANGEL3');
  });

  it('tracks used codes across calls via the shared set', () => {
    const used = new Set<string>();
    makeCode('JUAN CARLOS', used);
    makeCode('VICTOR HUGO', used);

    expect(used.has('JUANCARLOS')).toBe(true);
    expect(used.has('VICTORHUGO')).toBe(true);
    expect(used.size).toBe(2);
  });

  it('handles lowercase input', () => {
    const used = new Set<string>();
    expect(makeCode('juan carlos', used)).toBe('JUANCARLOS');
  });
});

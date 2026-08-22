import { describe, expect, it } from 'vitest';
import { normalizeStaffCode } from '@/lib/staff-code';

describe('normalizeStaffCode', () => {
  it.each([
    ['EDWINERCEG ', 'EDWINERCEG'],
    [' LEOGASCA006', 'LEOGASCA006'],
    ['VanessaMaricela ', 'VANESSAMARICELA'],
    ['edwinerceg', 'EDWINERCEG'],
  ])('normalizes %j to match the stored code %j case-insensitively', (input, stored) => {
    expect(normalizeStaffCode(input).toLowerCase()).toBe(stored.toLowerCase());
  });

  it('normalizes an all-whitespace code to an empty string', () => {
    expect(normalizeStaffCode('   ')).toBe('');
  });
});

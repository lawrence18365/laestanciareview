import { describe, expect, it } from 'vitest';
import { isPositiveRating } from '@/lib/feedback';

describe('isPositiveRating', () => {
  it.each([
    [1, false],
    [3, false],
    [4, true],
    [5, true],
  ])('classifies a %i-star rating as %s', (rating, expected) => {
    expect(isPositiveRating(rating)).toBe(expected);
  });
});

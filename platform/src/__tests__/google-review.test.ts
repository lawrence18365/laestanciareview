import { describe, expect, it } from 'vitest';
import {
  derivedGoogleReviewUrl,
  isDerivedGoogleReviewUrl,
  reviewUrlFor,
} from '@/lib/google-review';

const PLACE_ID = 'ChIJp_TjY77Hz4UROpI4_OVO14w';

describe('reviewUrlFor', () => {
  it('returns the stored review URL when there is one', () => {
    expect(
      reviewUrlFor({
        googleReviewUrl: 'https://g.page/r/Caz8tUjHvtOBEBM/review',
        googlePlaceId: PLACE_ID,
      }),
    ).toBe('https://g.page/r/Caz8tUjHvtOBEBM/review');
  });

  it('derives the write-a-review URL from a Place ID alone', () => {
    // The self-serve case: /contacto captures a Place ID and nothing else.
    expect(reviewUrlFor({ googleReviewUrl: null, googlePlaceId: PLACE_ID })).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    );
  });

  it('treats an empty review URL as unset and derives from the Place ID', () => {
    expect(reviewUrlFor({ googleReviewUrl: '', googlePlaceId: PLACE_ID })).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    );
  });

  it('returns null when the restaurant has told us nothing', () => {
    expect(reviewUrlFor({ googleReviewUrl: null, googlePlaceId: null })).toBeNull();
    expect(reviewUrlFor({ googleReviewUrl: '', googlePlaceId: '' })).toBeNull();
  });
});

describe('derivedGoogleReviewUrl / isDerivedGoogleReviewUrl', () => {
  it('flags URLs we derived ourselves', () => {
    expect(isDerivedGoogleReviewUrl(derivedGoogleReviewUrl(PLACE_ID))).toBe(true);
  });

  it('does not flag a URL the restaurant typed', () => {
    expect(isDerivedGoogleReviewUrl('https://g.page/r/abc/review')).toBe(false);
    expect(isDerivedGoogleReviewUrl('https://maps.app.goo.gl/xyz')).toBe(false);
    expect(isDerivedGoogleReviewUrl(null)).toBe(false);
    expect(isDerivedGoogleReviewUrl('')).toBe(false);
  });
});

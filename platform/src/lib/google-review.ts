/**
 * The Google review link a guest is sent to.
 *
 * Two sources, one order:
 *   1. `restaurants.google_review_url` — the restaurant's own link (a g.page
 *      short link, a Maps URL, anything).
 *   2. `restaurants.google_place_id` — derived into Google's own
 *      "write a review" URL. This is what the /contacto signup flow captures
 *      from the Places autocomplete, and it is enough on its own: previously a
 *      restaurant could go through signup, get a Place ID stored, and still be
 *      offered no Google option because the URL column was empty.
 *
 * Dependency-free and side-effect-free on import so the guest flow (server),
 * the dashboard settings form (client) and the unit tests all share it.
 */

export interface GoogleReviewSource {
  googleReviewUrl: string | null;
  googlePlaceId: string | null;
}

/** Prefix of the review URL derived from a Google Place ID. */
export const DERIVED_REVIEW_URL_PREFIX =
  'https://search.google.com/local/writereview?placeid=';

/** Google's own "write a review" URL for a Place ID. */
export function derivedGoogleReviewUrl(placeId: string): string {
  return `${DERIVED_REVIEW_URL_PREFIX}${placeId}`;
}

/**
 * True when the stored URL is one we derived from a Place ID ourselves — i.e.
 * it is safe to replace when a different Place ID is selected. A URL the
 * restaurant typed (g.page/…, maps.app.goo.gl/…) is never touched.
 */
export function isDerivedGoogleReviewUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(DERIVED_REVIEW_URL_PREFIX);
}

/**
 * The URL the guest flow offers, or null when the restaurant has told us
 * nothing about its Google profile (in which case Google is not offered at all).
 */
export function reviewUrlFor(restaurant: GoogleReviewSource): string | null {
  if (restaurant.googleReviewUrl) return restaurant.googleReviewUrl;
  if (restaurant.googlePlaceId) return derivedGoogleReviewUrl(restaurant.googlePlaceId);
  return null;
}

/**
 * Star-count buckets.
 *
 * This file answers exactly one question: "is this rating in the top bucket?"
 * It says nothing about whether the guest was happy. Those are different
 * questions, and conflating them caused the Harbor's Angelopolis #28768
 * incident — see review-classification.ts.
 *
 * Use POSITIVE_RATING_MIN / isPositiveRating() only where a *star bucket* is
 * genuinely what is meant, which today is the SQL in queries.ts
 * (getUnreadLowRatingCount, getNewFeedbackCount) where the badge counts
 * complaints by rating and cannot run JavaScript text analysis.
 *
 * For anything a human reads — push titles, email subjects and colours, inbox
 * placement — use classifyReview() from review-classification.ts instead.
 */

/** Lowest star rating that still falls in the top bucket. Not a sentiment. */
export const POSITIVE_RATING_MIN = 4;

/**
 * True when the rating sits in the top star bucket.
 *
 * Deliberately not named isPositiveReview: a 4-star review can carry a
 * complaint, and this function has no way to know.
 */
export function isPositiveRating(rating: number): boolean {
  return rating >= POSITIVE_RATING_MIN;
}

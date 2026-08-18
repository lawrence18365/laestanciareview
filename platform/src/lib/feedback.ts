export const POSITIVE_RATING_MIN = 4;

export function isPositiveRating(rating: number): boolean {
  return rating >= POSITIVE_RATING_MIN;
}

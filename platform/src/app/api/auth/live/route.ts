import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getLiveStats } from '@/lib/queries';
import { getGoogleRatingTrend, getGoogleReviewsAddedToday } from '@/lib/google-places';

export const dynamic = 'force-dynamic';

/**
 * Live view polling endpoint.
 * Called every 15 seconds from the tablet.
 * Returns ONLY cached data from the DB - zero external API calls.
 * Google ratings are refreshed by the daily cron, not here.
 */
export async function GET() {
  const session = await verifySession();
  if (!session)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant)
    return Response.json({ error: 'Not found' }, { status: 404 });

  const [data, trend, googleReviewsToday] = await Promise.all([
    getLiveStats(restaurant.id, restaurant.googleThreshold),
    restaurant.googlePlaceId
      ? getGoogleRatingTrend(restaurant.id)
      : null,
    restaurant.googlePlaceId
      ? getGoogleReviewsAddedToday(restaurant.id, restaurant.googleReviewCount ?? null)
      : null,
  ]);

  return Response.json({
    restaurantName: restaurant.name,
    googleRating: restaurant.googleRating
      ? parseFloat(restaurant.googleRating)
      : null,
    googleReviewCount: restaurant.googleReviewCount ?? null,
    googleReviewsToday,
    googleTrend: trend,
    ...data,
  });
}

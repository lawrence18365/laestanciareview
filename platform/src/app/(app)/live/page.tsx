import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getLiveStats } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import { refreshGoogleRating, getGoogleRatingTrend, getGoogleReviewsAddedToday } from '@/lib/google-places';
import LiveView from '@/components/dashboard/LiveView';

export default async function LivePage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  // On page load ONLY (not on polling) - refresh if cache >24h stale.
  // This is a fallback in case the daily cron missed.
  // Cost: 0-1 Google API call per page load, only if stale.
  if (restaurant.googlePlaceId) {
    await refreshGoogleRating(
      restaurant.id,
      restaurant.googlePlaceId,
      24 * 60 * 60 * 1000, // 24 hours - matches the daily cron cadence
      restaurant.googleRatingUpdatedAt,
    ).catch(() => {});
  }

  const brand = getBrandForSlug(session.slug);

  const [freshRestaurant, initialData, trend] = await Promise.all([
    // Re-fetch restaurant to get potentially updated rating
    getRestaurantBySlug(session.slug).then((r) => r ?? restaurant),
    getLiveStats(restaurant.id, restaurant.googleThreshold),
    restaurant.googlePlaceId
      ? getGoogleRatingTrend(restaurant.id)
      : null,
  ]);

  const googleReviewsToday = freshRestaurant.googlePlaceId
    ? await getGoogleReviewsAddedToday(restaurant.id, freshRestaurant.googleReviewCount ?? null)
    : null;

  return (
    <LiveView
      restaurantName={freshRestaurant.name}
      logoSrc={brand.logo}
      logoDarkBg={brand.darkBg}
      googleRating={
        freshRestaurant.googleRating
          ? parseFloat(freshRestaurant.googleRating)
          : null
      }
      googleReviewCount={freshRestaurant.googleReviewCount ?? null}
      googleReviewsToday={googleReviewsToday}
      googleTrend={trend}
      initialData={initialData}
    />
  );
}

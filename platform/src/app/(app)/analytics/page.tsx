import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  getRestaurantBySlug,
  getWeeklyStats,
  getAllTimeStats,
  getRatingDistribution,
  getDailyReviewCounts,
  getGoogleConversionRate,
  getLeaderboard,
  getROIStats,
} from '@/lib/queries';
import { getGoogleRatingTrend } from '@/lib/google-places';
import AnalyticsView from '@/components/dashboard/AnalyticsView';

export default async function AnalyticsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const [weeklyStats, allTimeStats, ratingDist, dailyCounts, conversion, leaderboard, roiStats, googleTrend] =
    await Promise.all([
      getWeeklyStats(restaurant.id),
      getAllTimeStats(restaurant.id),
      getRatingDistribution(restaurant.id),
      getDailyReviewCounts(restaurant.id, 30),
      getGoogleConversionRate(restaurant.id, restaurant.googleThreshold),
      getLeaderboard(restaurant.id),
      getROIStats(restaurant.id, restaurant.googleThreshold),
      restaurant.googlePlaceId
        ? getGoogleRatingTrend(restaurant.id)
        : null,
    ]);

  return (
    <AnalyticsView
      weeklyStats={weeklyStats}
      allTimeStats={allTimeStats}
      ratingDistribution={ratingDist}
      dailyCounts={dailyCounts}
      conversion={conversion}
      leaderboard={leaderboard}
      roiStats={roiStats}
      googleTrend={googleTrend}
    />
  );
}

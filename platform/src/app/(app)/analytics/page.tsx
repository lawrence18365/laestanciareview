import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  getRestaurantBySlug,
  getWeeklyStats,
  getAllTimeStats,
  getDailyReviewCounts,
  getGoogleConversionRate,
  getAllTimeStaffRanking,
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

  const [weeklyStats, allTimeStats, dailyCounts, conversion, staffRanking, roiStats, googleTrend] =
    await Promise.all([
      getWeeklyStats(restaurant.id),
      getAllTimeStats(restaurant.id),
      getDailyReviewCounts(restaurant.id, 30),
      getGoogleConversionRate(restaurant.id, restaurant.googleThreshold),
      getAllTimeStaffRanking(restaurant.id),
      getROIStats(restaurant.id, restaurant.googleThreshold),
      restaurant.googlePlaceId
        ? getGoogleRatingTrend(restaurant.id)
        : null,
    ]);

  return (
    <AnalyticsView
      weeklyStats={weeklyStats}
      allTimeStats={allTimeStats}
      dailyCounts={dailyCounts}
      conversion={conversion}
      staffRanking={staffRanking}
      roiStats={roiStats}
      googleTrend={googleTrend}
    />
  );
}

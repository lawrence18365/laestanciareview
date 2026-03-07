import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  getRestaurantBySlug,
  getWeeklyStats,
  getLastWeekStats,
  getLeaderboard,
  getNewFeedbackCount,
  getUnreadLowRatingCount,
  getROIStats,
  getMonthlyStats,
} from '@/lib/queries';
import { getGoogleRatingTrend, getGoogleRatingHistory } from '@/lib/google-places';
import DashboardView from '@/components/dashboard/DashboardView';

export default async function DashboardPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owners land on /overview, not /dashboard
  if (session.role === 'owner') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const [
    stats,
    lastWeekStats,
    leaderboard,
    unreadCount,
    unreadLowCount,
    roiStats,
    monthlyStats,
    googleTrend,
    googleHistory,
  ] = await Promise.all([
    getWeeklyStats(restaurant.id),
    getLastWeekStats(restaurant.id),
    getLeaderboard(restaurant.id),
    getNewFeedbackCount(restaurant.id),
    getUnreadLowRatingCount(restaurant.id, restaurant.googleThreshold),
    getROIStats(restaurant.id, restaurant.googleThreshold),
    getMonthlyStats(restaurant.id, 12, restaurant.googleThreshold),
    restaurant.googlePlaceId
      ? getGoogleRatingTrend(restaurant.id)
      : null,
    restaurant.googlePlaceId
      ? getGoogleRatingHistory(restaurant.id)
      : [],
  ]);

  return (
    <DashboardView
      stats={stats}
      lastWeekStats={lastWeekStats}
      leaderboard={leaderboard}
      unreadCount={unreadCount}
      unreadLowCount={unreadLowCount}
      roiStats={roiStats}
      monthlyStats={monthlyStats}
      googleTrend={googleTrend}
      googleHistory={googleHistory}
      googleRating={restaurant.googleRating ? parseFloat(restaurant.googleRating) : null}
      googleReviewCount={restaurant.googleReviewCount ?? null}
    />
  );
}

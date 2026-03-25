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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');

  const params = await searchParams;
  const isMultiView = session.role === 'owner' || session.role === 'regional';

  // Owners & regional managers without a slug param land on /overview
  if (isMultiView && !params.slug) redirect('/overview');

  // Determine which slug to load
  const targetSlug = isMultiView && params.slug ? params.slug : session.slug;
  const restaurant = await getRestaurantBySlug(targetSlug);
  if (!restaurant) redirect(isMultiView ? '/overview' : '/login');

  // Regional managers can only view restaurants in their region
  if (session.role === 'regional' && restaurant.region !== session.region) {
    redirect('/overview');
  }

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

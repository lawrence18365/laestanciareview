import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  getGroupKeyBySlug,
  getRestaurantBySlug,
  getWeeklyStats,
  getLastWeekStats,
  getLeaderboard,
  restaurantHasStaff,
  getNewFeedbackCount,
  getUnreadLowRatingCount,
  getROIStats,
  getMonthlyStats,
} from '@/lib/queries';
import { getGoogleRatingTrend, getGoogleRatingHistory, getGoogleReviewsAddedToday } from '@/lib/google-places';
import { reviewUrlFor } from '@/lib/google-review';
import { sameGroup } from '@/lib/group-scope';
import { isSolo } from '@/lib/onboarding-profile';
import { reviewUrlFor as qrReviewUrlFor } from '@/lib/qr';
import DashboardView from '@/components/dashboard/DashboardView';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import { getMapsRankSummary, type KeywordSummary } from '@/lib/maps-rank';

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

  // Owner/regional accounts can only open locations of their own group.
  if (isMultiView && restaurant.slug !== session.slug) {
    const viewerGroup = await getGroupKeyBySlug(session.slug);
    if (!sameGroup(viewerGroup, restaurant.groupKey)) redirect('/overview');
  }

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
    hasStaff,
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
    restaurantHasStaff(restaurant.id),
  ]);

  const googleReviewsToday = restaurant.googlePlaceId
    ? await getGoogleReviewsAddedToday(restaurant.id, restaurant.googleReviewCount ?? null)
    : null;

  // The dashboard must never break on Maps rank data: any failure renders no card.
  let mapsSummaries: KeywordSummary[] = [];
  if (process.env.MAPS_RANK_ENABLED === 'true') {
    try {
      mapsSummaries = await getMapsRankSummary(restaurant.id);
    } catch {
      mapsSummaries = [];
    }
  }

  return (
    <>
      {/* showGoogleConnect is GM-only: an owner or regional reaches this page
          through ?slug, and the fix (Ajustes) is not theirs to make. */}
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
        googleReviewsToday={googleReviewsToday}
        showGoogleConnect={session.role === 'gm' && reviewUrlFor(restaurant) === null}
        isSolo={isSolo(restaurant)}
        soloShareUrl={isSolo(restaurant) ? qrReviewUrlFor(restaurant.slug) : undefined}
        hasStaff={hasStaff}
      />
      <div className="page-container" style={{ paddingTop: 0 }}>
        <MapsRankCard summaries={mapsSummaries} />
      </div>
    </>
  );
}

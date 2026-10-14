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
import {
  getGoogleRatingTrend,
  getGoogleRatingHistory,
  getGoogleReviewsAddedToday,
  getGoogleReviewCountsSinceJoin,
} from '@/lib/google-places';
import { whatsappSharesToday } from '@/lib/ask-today';
import { reviewUrlFor } from '@/lib/google-review';
import { sameGroup } from '@/lib/group-scope';
import { isSolo } from '@/lib/onboarding-profile';
import { generateQrDataUrl, reviewUrlFor as qrReviewUrlFor } from '@/lib/qr';
import DashboardView from '@/components/dashboard/DashboardView';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import FirstRatingCard from '@/components/dashboard/FirstRatingCard';
import { canUse, isSelfServe, planFor } from '@/lib/entitlements';
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

  // Self-serve upgrade surfaces. Grupo restaurants (group_key set) get none, so
  // their render is unchanged.
  const selfServe = isSelfServe(restaurant);
  const plan = planFor(restaurant);
  const mapsLocked = selfServe && !canUse(plan, 'maps_rank');
  const showFirstRating =
    selfServe && (plan === 'trial' || plan === 'free') && Number(roiStats.totalReviews) >= 1;

  // The dashboard must never break on Maps rank data: any failure renders no card.
  // A locked card gets no data at all.
  let mapsSummaries: KeywordSummary[] = [];
  if (process.env.MAPS_RANK_ENABLED === 'true' && !mapsLocked) {
    try {
      mapsSummaries = await getMapsRankSummary(restaurant.id);
    } catch {
      mapsSummaries = [];
    }
  }

  // Self-serve (solo / team) leads the empty state with the full-screen QR.
  // NULL team_mode (every legacy / Grupo restaurant) gets nothing extra.
  let qrShare: React.ComponentProps<typeof DashboardView>['selfServe'];
  if (restaurant.teamMode === 'solo' || restaurant.teamMode === 'team') {
    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await generateQrDataUrl(restaurant.slug);
    } catch {
      qrDataUrl = null;
    }
    const [askTodayCount, reviewCounts] = await Promise.all([
      whatsappSharesToday(restaurant.id),
      getGoogleReviewCountsSinceJoin(restaurant.id, restaurant.createdAt).catch(() => null),
    ]);
    qrShare = {
      restaurantName: restaurant.name,
      qrDataUrl,
      reviewUrl: qrReviewUrlFor(restaurant.slug),
      askTodayCount,
      reviewCounts,
    };
  }

  return (
    <>
      {showFirstRating && (plan === 'trial' || plan === 'free') && (
        <div className="page-container" style={{ paddingBottom: 0 }}>
          <FirstRatingCard
            slug={restaurant.slug}
            plan={plan}
            sentToGoogle={Number(roiStats.googleSends)}
          />
        </div>
      )}
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
        selfServe={qrShare}
        hasStaff={hasStaff}
      />
      <div className="page-container" style={{ paddingTop: 0 }}>
        <MapsRankCard summaries={mapsSummaries} locked={mapsLocked} />
      </div>
    </>
  );
}

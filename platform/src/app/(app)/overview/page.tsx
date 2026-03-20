import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getOverviewStats, getNewFeedbackCount, getROIStats } from '@/lib/queries';
import { getGoogleRatingTrendBatch } from '@/lib/google-places';
import OwnerOverview from '@/components/dashboard/OwnerOverview';

export default async function OverviewPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owner & regional managers only
  if (session.role !== 'owner' && session.role !== 'regional') redirect('/dashboard');

  const stats = await getOverviewStats(session.role === 'regional' ? session.region : undefined);

  // Fetch unresolved counts, ROI stats, and Google trends in parallel
  const unresolvedCounts: Record<number, number> = {};
  const roiByLocation: Record<number, Awaited<ReturnType<typeof getROIStats>>> = {};
  const restaurantIds = stats.map((r) => r.restaurantId);

  const [, , googleTrends] = await Promise.all([
    // Unresolved feedback per location
    Promise.all(
      stats.map(async (r) => {
        unresolvedCounts[r.restaurantId] = await getNewFeedbackCount(r.restaurantId);
      }),
    ),
    // ROI stats per location
    Promise.all(
      stats.map(async (r) => {
        roiByLocation[r.restaurantId] = await getROIStats(r.restaurantId, r.googleThreshold);
      }),
    ),
    // Google trends per location
    getGoogleRatingTrendBatch(restaurantIds),
  ]);

  return (
    <OwnerOverview
      stats={stats}
      unresolvedCounts={unresolvedCounts}
      roiByLocation={roiByLocation}
      googleTrends={googleTrends}
    />
  );
}

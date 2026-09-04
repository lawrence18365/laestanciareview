import { NextRequest } from 'next/server';
import {
  getRestaurantsWithEmail,
  getOwnerAccounts,
  getLastWeekStats,
  getWeekBeforeLastStats,
  getLastWeekLeaderboard,
  getNewFeedbackCount,
  getOverviewStats,
  getOperationalRestaurants,
  getRegionalAccounts,
} from '@/lib/queries';
import {
  formatStaffAnomaly,
  getStaffAnomalies,
} from '@/lib/anomalies';
import { getGoogleRatingTrend } from '@/lib/google-places';
import { sendWeeklyDigest, sendOwnerDigest } from '@/lib/email';
import { sendPushToRestaurant } from '@/lib/push';
import { isoWeekMexico } from '@/lib/mexico-tz';
import {
  getComplaintSlaStats,
  getOverdueComplaintPreviews,
} from '@/lib/complaint-sla';

function staffAnomalyTitle(count: number): string {
  return `${count} ${count === 1 ? 'cambio anormal' : 'cambios anormales'} en el equipo`;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || secret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\\n/g, '').trim();

  let gmSent = 0;
  let gmFailed = 0;
  let ownerSent = 0;
  let ownerFailed = 0;
  let staffAnomalyPushSent = 0;
  let staffAnomalyPushTargeted = 0;
  const gmSkippedNoEmail: string[] = [];
  const ownerSkippedNoEmail: string[] = [];

  const [restaurants, operational, owners, regionalAccounts, overviewStats] = await Promise.all([
    getRestaurantsWithEmail(),
    getOperationalRestaurants(),
    getOwnerAccounts(),
    getRegionalAccounts(),
    getOverviewStats(),
  ]);

  const digestNow = new Date();
  const anomalousLocations = await Promise.all(
    operational.map(async (restaurant) => ({
      restaurant,
      staffAnomalies: await getStaffAnomalies(restaurant.id, digestNow),
    })),
  );
  const anomaliesByRestaurant = new Map(
    anomalousLocations.map(({ restaurant, staffAnomalies }) => [restaurant.id, staffAnomalies]),
  );
  const isoWeek = isoWeekMexico(digestNow);

  // Monday staff anomaly push for operational restaurants.
  for (const { restaurant, staffAnomalies } of anomalousLocations) {
    if (staffAnomalies.length === 0) continue;

    try {
      const result = await sendPushToRestaurant(restaurant.id, {
        title: staffAnomalyTitle(staffAnomalies.length),
        body: formatStaffAnomaly(staffAnomalies[0]),
        url: '/staff',
        tag: `staff-anomaly-${restaurant.id}-${isoWeek}`,
      }, { kind: 'staff_anomaly' });
      staffAnomalyPushSent += result.sent;
      staffAnomalyPushTargeted += result.targeted;
    } catch (err) {
      console.error(`[digest] staff anomaly push failed for ${restaurant.name}:`, err);
    }
  }

  // --- GM digests ---

  for (const r of restaurants) {
    if (r.isOwner || r.isRegional) continue;
    if (!r.managerEmail) {
      console.warn(`[digest] no email for ${r.slug}`);
      gmSkippedNoEmail.push(r.slug);
      continue;
    }

    try {
      const [lastWeek, weekBefore, topPerformers, unresolvedCount, googleTrend] =
        await Promise.all([
          getLastWeekStats(r.id, r.googleThreshold),
          getWeekBeforeLastStats(r.id, r.googleThreshold),
          getLastWeekLeaderboard(r.id, 5),
          getNewFeedbackCount(r.id),
          r.googlePlaceId ? getGoogleRatingTrend(r.id) : Promise.resolve(null),
        ]);

      const result = await sendWeeklyDigest({
        to: r.managerEmail,
        restaurantName: r.name,
        lastWeek,
        weekBefore,
        unresolvedCount,
        topPerformers,
        staffAnomalies: anomaliesByRestaurant.get(r.id) ?? [],
        dashboardUrl: `${baseUrl}/dashboard`,
        googleTrend,
      });

      if (result.success) {
        gmSent++;
      } else {
        gmFailed++;
      }
    } catch (err) {
      console.error(`[digest] GM failed for ${r.name}:`, err);
      gmFailed++;
    }
  }

  // --- Owner digests ---
  for (const owner of owners) {
    if (!owner.managerEmail) {
      console.warn(`[digest] no email for ${owner.slug}`);
      ownerSkippedNoEmail.push(owner.slug);
      continue;
    }

    try {
      // Get unresolved counts and Google trends for each location
      const locations = await Promise.all(
        overviewStats.map(async (s) => {
          const [unresolved, googleTrend, topStaff, complaintStats, overdueComplaints] = await Promise.all([
            getNewFeedbackCount(s.restaurantId),
            getGoogleRatingTrend(s.restaurantId),
            getLastWeekLeaderboard(s.restaurantId, 3),
            getComplaintSlaStats(s.restaurantId, digestNow, 7),
            getOverdueComplaintPreviews(s.restaurantId, digestNow, 3),
          ]);
          return {
            name: s.restaurantName,
            reviews: s.weeklyReviews,
            avgRating: s.weeklyAvg ?? 0,
            googleSends: s.weeklyGoogle,
            intercepted: s.weeklyIntercepted,
            unresolved,
            ratingChange: googleTrend?.ratingChange ?? null,
            currentRating: googleTrend?.currentRating ?? null,
            topStaff: topStaff.map((person) => ({
              name: person.staffName ?? 'Desconocido',
              avgRating: person.avgRating,
              reviewCount: person.reviewCount,
            })),
            staffAnomalies: anomaliesByRestaurant.get(s.restaurantId) ?? [],
            complaints: {
              received: complaintStats.received,
              resolvedWithin24h: complaintStats.resolvedWithin24h,
              overdueOpen: complaintStats.overdueOpen,
              overdue: overdueComplaints,
            },
          };
        }),
      );

      const result = await sendOwnerDigest({
        to: owner.managerEmail,
        locations,
        dashboardUrl: `${baseUrl}/overview`,
      });

      if (result.success) {
        ownerSent++;
      } else {
        ownerFailed++;
      }
    } catch (err) {
      console.error(`[digest] Owner failed for ${owner.name}:`, err);
      ownerFailed++;
    }
  }

  // Aggregate owner and regional staff anomaly push.
  const escalationAccounts = new Map(
    [...owners, ...regionalAccounts].map((account) => [account.id, account]),
  ).values();
  for (const account of escalationAccounts) {
    const scopedLocations = account.isOwner
      ? anomalousLocations
      : anomalousLocations.filter(({ restaurant }) => restaurant.region === account.region);
    const locationsWithAnomalies = scopedLocations.filter(
      ({ staffAnomalies }) => staffAnomalies.length > 0,
    );
    const totalAnomalies = locationsWithAnomalies.reduce(
      (sum, location) => sum + location.staffAnomalies.length,
      0,
    );
    if (totalAnomalies === 0) continue;

    try {
      const result = await sendPushToRestaurant(account.id, {
        title: staffAnomalyTitle(totalAnomalies),
        body: formatStaffAnomaly(locationsWithAnomalies[0].staffAnomalies[0]),
        url: '/overview',
        tag: `staff-anomaly-${account.id}-${isoWeek}`,
      }, { kind: 'staff_anomaly' });
      staffAnomalyPushSent += result.sent;
      staffAnomalyPushTargeted += result.targeted;
    } catch (err) {
      console.error(`[digest] staff anomaly push failed for ${account.name}:`, err);
    }
  }

  return Response.json({
    gm: { sent: gmSent, failed: gmFailed, skippedNoEmail: gmSkippedNoEmail },
    owner: { sent: ownerSent, failed: ownerFailed, skippedNoEmail: ownerSkippedNoEmail },
    staffAnomalyPush: {
      sent: staffAnomalyPushSent,
      targeted: staffAnomalyPushTargeted,
    },
  });
}

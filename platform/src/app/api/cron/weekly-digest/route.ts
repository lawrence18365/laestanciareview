import { NextRequest } from 'next/server';
import {
  getRestaurantsWithEmail,
  getOwnerAccounts,
  getLastWeekStats,
  getWeekBeforeLastStats,
  getLastWeekLeaderboard,
  getNewFeedbackCount,
  getOverviewStats,
  getQuietStaff,
  getOperationalRestaurants,
  getRegionalAccounts,
} from '@/lib/queries';
import { getGoogleRatingTrend } from '@/lib/google-places';
import { sendWeeklyDigest, sendOwnerDigest } from '@/lib/email';
import { sendPushToRestaurant } from '@/lib/push';
import { isoWeekMexico } from '@/lib/mexico-tz';
import {
  getComplaintSlaStats,
  getOverdueComplaintPreviews,
} from '@/lib/complaint-sla';

function quietStaffTitle(count: number): string {
  return `${count} ${count === 1 ? 'mesero' : 'meseros'} dejaron de pedir opiniones`;
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
  let quietPushSent = 0;
  let quietPushTargeted = 0;
  const gmSkippedNoEmail: string[] = [];
  const ownerSkippedNoEmail: string[] = [];

  const [restaurants, operational, owners, regionalAccounts, overviewStats] = await Promise.all([
    getRestaurantsWithEmail(),
    getOperationalRestaurants(),
    getOwnerAccounts(),
    getRegionalAccounts(),
    getOverviewStats(),
  ]);

  const quietLocations = await Promise.all(
    operational.map(async (restaurant) => ({
      restaurant,
      quietStaff: await getQuietStaff(restaurant.id),
    })),
  );
  const quietByRestaurant = new Map(
    quietLocations.map(({ restaurant, quietStaff }) => [restaurant.id, quietStaff]),
  );
  const isoWeek = isoWeekMexico();
  const digestNow = new Date();

  // --- Monday quiet-staff push for operational restaurants ---
  for (const { restaurant, quietStaff } of quietLocations) {
    if (quietStaff.length === 0) continue;

    try {
      const result = await sendPushToRestaurant(restaurant.id, {
        title: quietStaffTitle(quietStaff.length),
        body: quietStaff
          .slice(0, 3)
          .map((person) => person.staffName ?? person.staffCode ?? 'Desconocido')
          .join(', '),
        url: '/staff',
        tag: `quiet-staff-${restaurant.id}-${isoWeek}`,
      }, { kind: 'quiet_staff' });
      quietPushSent += result.sent;
      quietPushTargeted += result.targeted;
    } catch (err) {
      console.error(`[digest] quiet-staff push failed for ${restaurant.name}:`, err);
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
        quietStaff: quietByRestaurant.get(r.id) ?? [],
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
            quietStaff: quietByRestaurant.get(s.restaurantId) ?? [],
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

  // --- Aggregate owner and regional quiet-staff push ---
  const escalationAccounts = new Map(
    [...owners, ...regionalAccounts].map((account) => [account.id, account]),
  ).values();
  for (const account of escalationAccounts) {
    const scopedLocations = account.isOwner
      ? quietLocations
      : quietLocations.filter(({ restaurant }) => restaurant.region === account.region);
    const locationsWithQuiet = scopedLocations.filter(({ quietStaff }) => quietStaff.length > 0);
    const totalQuiet = locationsWithQuiet.reduce((sum, location) => sum + location.quietStaff.length, 0);
    if (totalQuiet === 0) continue;

    try {
      const result = await sendPushToRestaurant(account.id, {
        title: quietStaffTitle(totalQuiet),
        body: `${totalQuiet} meseros en ${locationsWithQuiet.length} sucursales`,
        url: '/overview',
        tag: `quiet-staff-${account.id}-${isoWeek}`,
      }, { kind: 'quiet_staff' });
      quietPushSent += result.sent;
      quietPushTargeted += result.targeted;
    } catch (err) {
      console.error(`[digest] quiet-staff push failed for ${account.name}:`, err);
    }
  }

  return Response.json({
    gm: { sent: gmSent, failed: gmFailed, skippedNoEmail: gmSkippedNoEmail },
    owner: { sent: ownerSent, failed: ownerFailed, skippedNoEmail: ownerSkippedNoEmail },
    quietPush: { sent: quietPushSent, targeted: quietPushTargeted },
  });
}

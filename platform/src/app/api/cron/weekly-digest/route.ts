import { NextRequest } from 'next/server';
import {
  getRestaurantsWithEmail,
  getOwnerAccounts,
  getLastWeekStats,
  getWeekBeforeLastStats,
  getLastWeekLeaderboard,
  getNewFeedbackCount,
  getOverviewStats,
} from '@/lib/queries';
import { getGoogleRatingTrend } from '@/lib/google-places';
import { sendWeeklyDigest, sendOwnerDigest } from '@/lib/email';

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

  // --- GM digests ---
  const restaurants = await getRestaurantsWithEmail();

  for (const r of restaurants) {
    if (!r.managerEmail || r.isOwner) continue;

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
  const owners = await getOwnerAccounts();
  const overviewStats = owners.length > 0 ? await getOverviewStats() : [];

  for (const owner of owners) {
    if (!owner.managerEmail) continue;

    try {
      // Get unresolved counts and Google trends for each location
      const locations = await Promise.all(
        overviewStats.map(async (s) => {
          const [unresolved, googleTrend] = await Promise.all([
            getNewFeedbackCount(s.restaurantId),
            getGoogleRatingTrend(s.restaurantId),
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

  return Response.json({
    gm: { sent: gmSent, failed: gmFailed },
    owner: { sent: ownerSent, failed: ownerFailed },
  });
}

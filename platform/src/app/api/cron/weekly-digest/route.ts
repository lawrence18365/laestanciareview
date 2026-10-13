import { NextRequest } from 'next/server';
import {
  getRestaurantsWithEmail,
  getOwnerAccounts,
  getLastWeekStats,
  getWeekBeforeLastStats,
  getLastWeekLeaderboard,
  restaurantHasStaff,
  getNewFeedbackCount,
  getOperationalRestaurants,
  getRegionalAccounts,
} from '@/lib/queries';
import {
  formatStaffAnomaly,
  getStaffAnomalies,
} from '@/lib/anomalies';
import { getGoogleRatingTrend } from '@/lib/google-places';
import { sendWeeklyDigest, sendWeeklyDigestTeaser, sendOwnerBriefing, sendRegionalBriefing, type BriefingLocation } from '@/lib/email';
import { planFor } from '@/lib/entitlements';
import type { GroupShareSummary } from '@/lib/maps-rank-group';
import {
  getWeeklySignals,
  getGuestSignals,
  getServiceSignals,
  getUpcomingBirthdays,
  lastCompleteWeekStart,
} from '@/lib/weekly-signal';
import { signalLabel } from '@/lib/location-signal';
import { sameGroup } from '@/lib/group-scope';
import { getGoogleRatingTrendBatch } from '@/lib/google-places';
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
  let regionalSent = 0;
  let regionalFailed = 0;
  const regionalSkippedNoEmail: string[] = [];
  const gmSkippedNoEmail: string[] = [];
  const ownerSkippedNoEmail: string[] = [];
  const ownerSkippedNoGroup: string[] = [];
  const regionalSkippedNoGroup: string[] = [];

  const [restaurants, operational, owners, regionalAccounts] = await Promise.all([
    getRestaurantsWithEmail(),
    getOperationalRestaurants(),
    getOwnerAccounts(),
    getRegionalAccounts(),
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
      // Free self-serve plan (US-15): two counts and a link to /plan. The
      // staff, anomaly, complaint and Google-trend detail is a paid feature.
      if (planFor(r) === 'free') {
        const lastWeek = await getLastWeekStats(r.id, r.googleThreshold);
        const result = await sendWeeklyDigestTeaser({
          to: r.managerEmail,
          restaurantName: r.name,
          ratings: lastWeek.totalReviews,
          sentToGoogle: lastWeek.googleSends,
        });
        if (result.success) {
          gmSent++;
        } else {
          gmFailed++;
        }
        continue;
      }

      const [lastWeek, weekBefore, topPerformers, unresolvedCount, googleTrend, hasStaff] =
        await Promise.all([
          getLastWeekStats(r.id, r.googleThreshold),
          getWeekBeforeLastStats(r.id, r.googleThreshold),
          getLastWeekLeaderboard(r.id, 5),
          getNewFeedbackCount(r.id),
          r.googlePlaceId ? getGoogleRatingTrend(r.id) : Promise.resolve(null),
          restaurantHasStaff(r.id),
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
        hasStaff,
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

  // --- Owner & regional briefings ---
  //
  // Framed on guests, not reviews, and scoped by region for the regionals.
  // Reports the last COMPLETE week: on a Wednesday the in-progress week holds
  // three days, which made every location look collapsed against a full prior
  // week (verified 2026-09-10, all twelve showed double-digit falls).
  const briefingWeekStart = lastCompleteWeekStart(digestNow);

  //
  // Every briefing is scoped to its recipient's group_key: an owner or regional
  // account only ever receives its own group's locations, and an account with no
  // group_key receives no briefing at all (fail closed). Signals are computed
  // once per distinct group.
  const briefingGroupKeys = [
    ...new Set(
      [...owners, ...regionalAccounts]
        .map((account) => account.groupKey)
        .filter((key): key is string => typeof key === 'string' && key !== ''),
    ),
  ];
  const briefingData = new Map<string, {
    allSignals: Awaited<ReturnType<typeof getWeeklySignals>>;
    allGuestSignals: Awaited<ReturnType<typeof getGuestSignals>>;
    allServiceSignals: Awaited<ReturnType<typeof getServiceSignals>>;
    ratingTrends: Awaited<ReturnType<typeof getGoogleRatingTrendBatch>>;
  }>();
  for (const groupKey of briefingGroupKeys) {
    const [allSignals, allGuestSignals, allServiceSignals] = await Promise.all([
      getWeeklySignals(briefingWeekStart, groupKey),
      getGuestSignals(briefingWeekStart, groupKey),
      getServiceSignals(briefingWeekStart, digestNow, groupKey),
    ]);
    const ratingTrends = await getGoogleRatingTrendBatch(allSignals.map((s) => s.restaurantId));
    briefingData.set(groupKey, { allSignals, allGuestSignals, allServiceSignals, ratingTrends });
  }

  const toBriefingLocation = (
    sig: Awaited<ReturnType<typeof getWeeklySignals>>[number],
    data: NonNullable<ReturnType<typeof briefingData.get>>,
  ): BriefingLocation => {
    const guestStats = data.allGuestSignals.get(sig.restaurantId);
    const serviceStats = data.allServiceSignals.get(sig.restaurantId);
    const trend = data.ratingTrends[sig.restaurantId] ?? null;
    return {
      name: sig.name,
      totalGuests: guestStats?.totalGuests ?? 0,
      newGuestsThisWeek: guestStats?.newThisWeek ?? 0,
      returningGuests: guestStats?.returningGuests ?? 0,
      courtesiesThisWeek: guestStats?.courtesiesThisWeek ?? 0,
      scansThisWeek: sig.scansThisWeek,
      scansLastWeek: sig.scansLastWeek,
      staffAskingThisWeek: sig.staffAskingThisWeek,
      staffAskingLastWeek: sig.staffAskingLastWeek,
      gmActiveDays: sig.gmActiveDays,
      complaintsThisWeek: serviceStats?.complaintsThisWeek ?? 0,
      overdueComplaints: serviceStats?.overdueOpen ?? 0,
      currentRating: trend?.currentRating ?? null,
      baselineRating: trend?.baselineRating ?? null,
      signalSummary: sig.signal.summary,
      signalLabel: signalLabel(sig.signal.signal),
      actionable: sig.signal.actionable,
    };
  };

  // Group share is opt-in. A failure omits the section so the briefing still sends.
  const groupShareByGroup = new Map<string, GroupShareSummary[]>();
  if (process.env.MAPS_RANK_EMAIL_ENABLED === 'true') {
    for (const groupKey of briefingGroupKeys) {
      // Dynamic import: the group share module pulls in the DB client, which needs DATABASE_URL at load time.
      try {
        const { getGroupShareSummary } = await import('@/lib/maps-rank-group');
        groupShareByGroup.set(groupKey, await getGroupShareSummary(groupKey));
      } catch (err) {
        console.error('[digest] group share failed:', err);
      }
    }
  }

  for (const owner of owners) {
    if (!owner.managerEmail) {
      console.warn(`[digest] no email for ${owner.slug}`);
      ownerSkippedNoEmail.push(owner.slug);
      continue;
    }
    const data = owner.groupKey ? briefingData.get(owner.groupKey) : undefined;
    if (!owner.groupKey || !data) {
      console.warn(`[digest] ${owner.slug} has no group_key; skipping briefing`);
      ownerSkippedNoGroup.push(owner.slug);
      continue;
    }
    const groupShare = groupShareByGroup.get(owner.groupKey);
    try {
      const result = await sendOwnerBriefing({
        to: owner.managerEmail,
        weekStart: briefingWeekStart,
        locations: data.allSignals.map((sig) => toBriefingLocation(sig, data)),
        dashboardUrl: `${baseUrl}/overview`,
        groupName: owner.name,
        groupShare,
      });
      if (result.success === false || result.skipped) ownerFailed++;
      else ownerSent++;
    } catch (err) {
      console.error(`[digest] Owner briefing failed for ${owner.name}:`, err);
      ownerFailed++;
    }
  }

  for (const account of regionalAccounts) {
    if (!account.managerEmail) {
      console.warn(`[digest] no email for ${account.slug}`);
      regionalSkippedNoEmail.push(account.slug);
      continue;
    }
    if (!account.region) {
      console.warn(`[digest] ${account.slug} has no region; skipping briefing`);
      regionalSkippedNoEmail.push(account.slug);
      continue;
    }
    const data = account.groupKey ? briefingData.get(account.groupKey) : undefined;
    if (!account.groupKey || !data) {
      console.warn(`[digest] ${account.slug} has no group_key; skipping briefing`);
      regionalSkippedNoGroup.push(account.slug);
      continue;
    }
    try {
      const scoped = data.allSignals.filter((s) => s.region === account.region);
      const birthdays = await getUpcomingBirthdays(digestNow, account.groupKey, account.region);
      const result = await sendRegionalBriefing({
        to: account.managerEmail,
        regionName: account.name,
        weekStart: briefingWeekStart,
        locations: scoped.map((sig) => toBriefingLocation(sig, data)),
        birthdays: birthdays.map((b) => ({
          locationName: b.locationName,
          guestName: b.guestName,
          birthday: b.birthday,
        })),
        dashboardUrl: `${baseUrl}/overview`,
      });
      if (result.success === false || result.skipped) regionalFailed++;
      else regionalSent++;
    } catch (err) {
      console.error(`[digest] Regional briefing failed for ${account.name}:`, err);
      regionalFailed++;
    }
  }

  // Aggregate owner and regional staff anomaly push.
  const escalationAccounts = new Map(
    [...owners, ...regionalAccounts].map((account) => [account.id, account]),
  ).values();
  for (const account of escalationAccounts) {
    // Same group only; an account (or location) with no group_key matches nothing.
    const groupLocations = anomalousLocations.filter(({ restaurant }) =>
      sameGroup(account.groupKey, restaurant.groupKey),
    );
    const scopedLocations = account.isOwner
      ? groupLocations
      : groupLocations.filter(({ restaurant }) => restaurant.region === account.region);
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
    owner: {
      sent: ownerSent,
      failed: ownerFailed,
      skippedNoEmail: ownerSkippedNoEmail,
      skippedNoGroup: ownerSkippedNoGroup,
    },
    regional: {
      sent: regionalSent,
      failed: regionalFailed,
      skippedNoEmail: regionalSkippedNoEmail,
      skippedNoGroup: regionalSkippedNoGroup,
    },
    staffAnomalyPush: {
      sent: staffAnomalyPushSent,
      targeted: staffAnomalyPushTargeted,
    },
  });
}

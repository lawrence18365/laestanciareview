/**
 * Compute defensible marketing stats from production data.
 *
 * Pulls every number we might want to put on the website from the live DB,
 * along with the sample size behind it, so the owner can see whether each
 * claim is backed by enough data to be meaningful.
 *
 * Output:
 *   1. Pretty-printed report to stdout
 *   2. JSON snapshot at platform/scripts/marketing-stats.json (for re-use)
 *
 * Usage: cd platform && npx tsx scripts/compute-marketing-stats.ts
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

import { writeFileSync } from 'fs';
import { join } from 'path';

type Stat = {
  label: string;
  value: number | string;
  sampleSize?: number;
  notes?: string;
};

function fmt(n: number, digits = 1): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(n: number): string {
  return `${fmt(n * 100, 1)}%`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function p(label: string, value: number | string, sampleSize?: number, notes?: string): Stat {
  const stat: Stat = { label, value };
  if (sampleSize !== undefined) stat.sampleSize = sampleSize;
  if (notes) stat.notes = notes;
  return stat;
}

async function main() {
  const { db } = await import('../src/db');
  const { restaurants, reviews, staff, googleRatingSnapshots } = await import(
    '../src/db/schema'
  );
  const { sql, inArray, eq, and } = await import('drizzle-orm');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  MARKETING STATS — REAL NUMBERS FROM PRODUCTION');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Generated: ${new Date().toISOString()}\n`);

  const allStats: Record<string, Stat[]> = {};

  // ──────────────────────────────────────────────────────────────────────
  // 1. CUSTOMER COUNT (replaces "500+ restaurants")
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  1. CUSTOMER COUNT');
  console.log('──────────────────────────────────────────────────────────');

  const allRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      subscriptionStatus: restaurants.subscriptionStatus,
      isOwner: restaurants.isOwner,
      isRegional: restaurants.isRegional,
      brand: restaurants.brand,
      city: restaurants.city,
      createdAt: restaurants.createdAt,
      googleThreshold: restaurants.googleThreshold,
    })
    .from(restaurants);

  // Owner/regional rows are admin views, not real restaurant locations.
  const realLocations = allRestaurants.filter(
    (r) => !r.isOwner && !r.isRegional,
  );
  const paying = realLocations.filter((r) =>
    ['active', 'trialing', 'past_due'].includes(r.subscriptionStatus),
  );
  const activeOnly = realLocations.filter((r) => r.subscriptionStatus === 'active');
  const trialing = realLocations.filter((r) => r.subscriptionStatus === 'trialing');

  const brands = new Set(realLocations.map((r) => r.brand).filter(Boolean));
  const cities = new Set(realLocations.map((r) => r.city).filter(Boolean));

  const customerStats: Stat[] = [
    p('Total locations in DB (excl. owner/regional rows)', realLocations.length),
    p('Paying locations (active + trialing + past_due)', paying.length),
    p('Active subscriptions only', activeOnly.length),
    p('Currently trialing', trialing.length),
    p('Distinct brands / restaurant groups', brands.size),
    p('Distinct cities', cities.size),
  ];

  customerStats.forEach((s) => console.log(`  ${s.label.padEnd(55)} ${s.value}`));
  allStats.customerCount = customerStats;
  console.log();

  if (paying.length === 0) {
    console.log('No paying customers — cannot compute downstream stats.');
    return;
  }

  const payingIds = paying.map((r) => r.id);
  const signupMap = new Map(paying.map((r) => [r.id, r.createdAt]));
  const thresholdMap = new Map(paying.map((r) => [r.id, r.googleThreshold]));
  const nameMap = new Map(paying.map((r) => [r.id, r.name]));

  // ──────────────────────────────────────────────────────────────────────
  // 2. REVIEWS CAPTURED ON-PLATFORM (replaces "412 reviews" lie)
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  2. REVIEWS CAPTURED ON-PLATFORM');
  console.log('──────────────────────────────────────────────────────────');

  const allReviews = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      sentToGoogle: reviews.sentToGoogle,
      status: reviews.status,
      feedback: reviews.feedback,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(inArray(reviews.restaurantId, payingIds));

  const reviewsByRestaurant = new Map<number, typeof allReviews>();
  for (const r of allReviews) {
    if (!reviewsByRestaurant.has(r.restaurantId))
      reviewsByRestaurant.set(r.restaurantId, []);
    reviewsByRestaurant.get(r.restaurantId)!.push(r);
  }

  const reviewCounts = paying.map((r) => reviewsByRestaurant.get(r.id)?.length ?? 0);
  const sentToGoogleTotal = allReviews.filter((r) => r.sentToGoogle).length;
  const lowStarTotal = allReviews.filter((r) => r.rating < 4).length;
  const fiveStarTotal = allReviews.filter((r) => r.rating === 5).length;
  const fourStarTotal = allReviews.filter((r) => r.rating === 4).length;

  const reviewStats: Stat[] = [
    p('Total taps captured across all customers', allReviews.length),
    p('5-star ratings', fiveStarTotal),
    p('4-star ratings', fourStarTotal),
    p('Low-star feedback (1–3) intercepted before Google', lowStarTotal),
    p('Routed to Google review form (sent_to_google = true)', sentToGoogleTotal),
    p(
      'Avg taps per paying restaurant (mean)',
      fmt(mean(reviewCounts), 1),
      paying.length,
    ),
    p(
      'Median taps per paying restaurant',
      fmt(median(reviewCounts), 0),
      paying.length,
    ),
    p('Max taps at a single restaurant', Math.max(...reviewCounts, 0)),
  ];

  reviewStats.forEach((s) =>
    console.log(`  ${s.label.padEnd(55)} ${s.value}${s.sampleSize !== undefined ? `  (n=${s.sampleSize})` : ''}`),
  );
  allStats.reviewsCaptured = reviewStats;
  console.log();

  // ──────────────────────────────────────────────────────────────────────
  // 3. GOOGLE REVIEW UPLIFT (THE GOLD CLAIM)
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  3. GOOGLE REVIEW UPLIFT (per-restaurant, signup→latest)');
  console.log('──────────────────────────────────────────────────────────');

  const snapshots = await db
    .select({
      restaurantId: googleRatingSnapshots.restaurantId,
      rating: googleRatingSnapshots.rating,
      reviewCount: googleRatingSnapshots.reviewCount,
      capturedAt: googleRatingSnapshots.capturedAt,
    })
    .from(googleRatingSnapshots)
    .where(inArray(googleRatingSnapshots.restaurantId, payingIds));

  const snapsByRestaurant = new Map<number, typeof snapshots>();
  for (const s of snapshots) {
    if (!snapsByRestaurant.has(s.restaurantId))
      snapsByRestaurant.set(s.restaurantId, []);
    snapsByRestaurant.get(s.restaurantId)!.push(s);
  }

  type Uplift = {
    restaurantId: number;
    name: string;
    daysTracked: number;
    firstReviewCount: number;
    lastReviewCount: number;
    reviewDelta: number;
    firstRating: number;
    lastRating: number;
    ratingDelta: number;
  };

  const uplifts: Uplift[] = [];
  for (const r of paying) {
    const snaps = (snapsByRestaurant.get(r.id) ?? []).sort(
      (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
    );
    if (snaps.length < 2) continue;
    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const days =
      (last.capturedAt.getTime() - first.capturedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (days < 7) continue; // less than a week of tracking — too noisy

    uplifts.push({
      restaurantId: r.id,
      name: r.name,
      daysTracked: days,
      firstReviewCount: first.reviewCount,
      lastReviewCount: last.reviewCount,
      reviewDelta: last.reviewCount - first.reviewCount,
      firstRating: parseFloat(first.rating),
      lastRating: parseFloat(last.rating),
      ratingDelta: parseFloat(last.rating) - parseFloat(first.rating),
    });
  }

  const reviewDeltas = uplifts.map((u) => u.reviewDelta);
  const ratingDeltas = uplifts.map((u) => u.ratingDelta);
  const daysTracked = uplifts.map((u) => u.daysTracked);

  const reviewsPerMonth = uplifts.map((u) =>
    u.daysTracked > 0 ? (u.reviewDelta / u.daysTracked) * 30 : 0,
  );

  const upliftStats: Stat[] = [
    p('Restaurants with ≥2 snapshots and ≥7 days tracked', uplifts.length),
    p(
      'Avg new Google reviews (mean across customers)',
      fmt(mean(reviewDeltas), 1),
      uplifts.length,
    ),
    p(
      'Median new Google reviews per customer',
      fmt(median(reviewDeltas), 0),
      uplifts.length,
    ),
    p(
      'Avg Google reviews / month (mean)',
      fmt(mean(reviewsPerMonth), 1),
      uplifts.length,
    ),
    p(
      'Median Google reviews / month',
      fmt(median(reviewsPerMonth), 1),
      uplifts.length,
    ),
    p(
      'Avg star-rating change (mean)',
      fmt(mean(ratingDeltas), 2),
      uplifts.length,
      'positive = rating went up',
    ),
    p(
      'Median star-rating change',
      fmt(median(ratingDeltas), 2),
      uplifts.length,
    ),
    p(
      'Avg observation window (days)',
      fmt(mean(daysTracked), 0),
      uplifts.length,
    ),
    p('Max review delta on a single customer', Math.max(...reviewDeltas, 0)),
    p(
      'Customers with positive review delta (any growth)',
      uplifts.filter((u) => u.reviewDelta > 0).length,
      uplifts.length,
    ),
    p(
      'Customers with positive rating delta',
      uplifts.filter((u) => u.ratingDelta > 0).length,
      uplifts.length,
    ),
  ];

  upliftStats.forEach((s) =>
    console.log(
      `  ${s.label.padEnd(55)} ${s.value}${s.sampleSize !== undefined ? `  (n=${s.sampleSize})` : ''}${s.notes ? `   — ${s.notes}` : ''}`,
    ),
  );

  if (uplifts.length > 0) {
    console.log('\n  Per-restaurant detail (sorted by review delta):');
    uplifts
      .sort((a, b) => b.reviewDelta - a.reviewDelta)
      .forEach((u) => {
        console.log(
          `    ${u.name.padEnd(35)}  +${String(u.reviewDelta).padStart(4)} reviews  ` +
            `${u.firstRating.toFixed(1)}→${u.lastRating.toFixed(1)} stars  ` +
            `over ${Math.round(u.daysTracked)}d`,
        );
      });
  }

  allStats.googleUplift = upliftStats;
  console.log();

  // ──────────────────────────────────────────────────────────────────────
  // 4. NEGATIVE-FEEDBACK INTERCEPTION (replaces "85% guest issues resolved")
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  4. NEGATIVE-FEEDBACK INTERCEPTION');
  console.log('──────────────────────────────────────────────────────────');

  // A "low-star" rating is one BELOW the restaurant's googleThreshold (default 4).
  // These are the ones we kept off Google and routed to private feedback.
  const intercepted = allReviews.filter((r) => {
    const t = thresholdMap.get(r.restaurantId) ?? 4;
    return r.rating < t;
  });
  const wouldHaveBeenPublic = allReviews.length;
  const interceptionRate =
    wouldHaveBeenPublic > 0 ? intercepted.length / wouldHaveBeenPublic : 0;

  const resolvedCount = allReviews.filter((r) => r.status === 'resolved').length;
  const reviewedCount = allReviews.filter((r) => r.status === 'reviewed').length;
  const newCount = allReviews.filter((r) => r.status === 'new').length;
  const lowStarHandled =
    intercepted.filter((r) => r.status === 'resolved' || r.status === 'reviewed')
      .length;
  const lowStarHandleRate =
    intercepted.length > 0 ? lowStarHandled / intercepted.length : 0;

  const interceptStats: Stat[] = [
    p('Total taps captured', allReviews.length),
    p(
      'Low-star (below threshold) — kept off Google',
      intercepted.length,
      undefined,
      `${pct(interceptionRate)} of taps`,
    ),
    p('Status: new (unhandled)', newCount),
    p('Status: reviewed (manager saw it)', reviewedCount),
    p('Status: resolved (issue closed out)', resolvedCount),
    p(
      'Low-star feedback acknowledged (reviewed OR resolved)',
      lowStarHandled,
      intercepted.length,
      `${pct(lowStarHandleRate)} of low-star feedback`,
    ),
  ];

  interceptStats.forEach((s) =>
    console.log(
      `  ${s.label.padEnd(55)} ${s.value}${s.sampleSize !== undefined ? `  (n=${s.sampleSize})` : ''}${s.notes ? `   — ${s.notes}` : ''}`,
    ),
  );
  allStats.feedbackInterception = interceptStats;
  console.log();

  // ──────────────────────────────────────────────────────────────────────
  // 5. STAFF PRODUCTIVITY
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  5. STAFF / SERVER PRODUCTIVITY');
  console.log('──────────────────────────────────────────────────────────');

  const allStaff = await db
    .select({
      id: staff.id,
      restaurantId: staff.restaurantId,
      active: staff.active,
    })
    .from(staff)
    .where(inArray(staff.restaurantId, payingIds));

  const activeStaff = allStaff.filter((s) => s.active);
  const reviewsWithStaff = allReviews.filter((r) => r.id && r.restaurantId);
  // We need staff_id specifically — pull it
  const staffedReviews = await db
    .select({
      staffId: reviews.staffId,
      restaurantId: reviews.restaurantId,
    })
    .from(reviews)
    .where(
      and(
        inArray(reviews.restaurantId, payingIds),
        sql`${reviews.staffId} IS NOT NULL`,
      ),
    );

  const reviewsPerStaff = new Map<number, number>();
  for (const r of staffedReviews) {
    if (r.staffId === null) continue;
    reviewsPerStaff.set(r.staffId, (reviewsPerStaff.get(r.staffId) ?? 0) + 1);
  }
  const staffReviewCounts = Array.from(reviewsPerStaff.values());

  const staffStats: Stat[] = [
    p('Total staff records on paying restaurants', allStaff.length),
    p('Active staff', activeStaff.length),
    p(
      'Reviews attributed to a specific staff member',
      staffedReviews.length,
      allReviews.length,
      `${pct(staffedReviews.length / Math.max(allReviews.length, 1))} of all taps`,
    ),
    p(
      'Avg reviews per active staff member (mean)',
      fmt(mean(staffReviewCounts), 1),
      staffReviewCounts.length,
    ),
    p(
      'Median reviews per active staff member',
      fmt(median(staffReviewCounts), 0),
      staffReviewCounts.length,
    ),
    p('Top performer review count', Math.max(...staffReviewCounts, 0)),
  ];

  staffStats.forEach((s) =>
    console.log(
      `  ${s.label.padEnd(55)} ${s.value}${s.sampleSize !== undefined ? `  (n=${s.sampleSize})` : ''}${s.notes ? `   — ${s.notes}` : ''}`,
    ),
  );
  allStats.staffProductivity = staffStats;
  console.log();

  // ──────────────────────────────────────────────────────────────────────
  // 6. TIME TO FIRST REVIEW (proves "10-minute setup" claim or refutes it)
  // ──────────────────────────────────────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  6. TIME-TO-FIRST-REVIEW');
  console.log('──────────────────────────────────────────────────────────');

  const ttf: number[] = []; // hours
  for (const r of paying) {
    const restoReviews = (reviewsByRestaurant.get(r.id) ?? []).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    if (restoReviews.length === 0) continue;
    const first = restoReviews[0];
    const signupAt = signupMap.get(r.id);
    if (!signupAt) continue;
    const hours = (first.createdAt.getTime() - signupAt.getTime()) / (1000 * 60 * 60);
    if (hours < 0) continue;
    ttf.push(hours);
  }

  const ttfStats: Stat[] = [
    p(
      'Avg hours from signup → first tap (mean)',
      fmt(mean(ttf), 1),
      ttf.length,
    ),
    p(
      'Median hours from signup → first tap',
      fmt(median(ttf), 1),
      ttf.length,
    ),
    p(
      'Customers with first tap within 24h of signup',
      ttf.filter((h) => h <= 24).length,
      ttf.length,
    ),
    p(
      'Customers with first tap within 7 days',
      ttf.filter((h) => h <= 24 * 7).length,
      ttf.length,
    ),
  ];

  ttfStats.forEach((s) =>
    console.log(
      `  ${s.label.padEnd(55)} ${s.value}${s.sampleSize !== undefined ? `  (n=${s.sampleSize})` : ''}`,
    ),
  );
  allStats.timeToFirstReview = ttfStats;
  console.log();

  // ──────────────────────────────────────────────────────────────────────
  // SUGGESTED MARKETING COPY (only if numbers support it)
  // ──────────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════');
  console.log('  SUGGESTED CLAIMS YOU CAN DEFEND');
  console.log('══════════════════════════════════════════════════════════\n');

  const suggestions: string[] = [];

  if (paying.length > 0) {
    suggestions.push(
      `"Used by ${paying.length} restaurant${paying.length === 1 ? '' : 's'}` +
        (brands.size > 1 ? ` across ${brands.size} brands` : '') +
        (cities.size > 1 ? ` in ${cities.size} cities` : '') +
        '."',
    );
  }
  if (allReviews.length >= 100) {
    suggestions.push(
      `"${allReviews.length.toLocaleString()}+ guest taps captured to date."`,
    );
  }
  if (uplifts.length >= 3) {
    const avgPerMonth = mean(reviewsPerMonth);
    const medPerMonth = median(reviewsPerMonth);
    suggestions.push(
      `"Customers add ${fmt(medPerMonth, 0)} new Google reviews / month on average ` +
        `(median across ${uplifts.length} tracked locations)."`,
    );
    suggestions.push(
      `"${fmt(avgPerMonth, 1)} new Google reviews per location per month (mean, n=${uplifts.length})."`,
    );
  }
  if (uplifts.length >= 3) {
    const positiveRatingPct = uplifts.filter((u) => u.ratingDelta > 0).length / uplifts.length;
    if (positiveRatingPct >= 0.5) {
      suggestions.push(
        `"${pct(positiveRatingPct)} of tracked customers saw their Google star rating ` +
          `improve (n=${uplifts.length})."`,
      );
    }
  }
  if (intercepted.length >= 20) {
    suggestions.push(
      `"${intercepted.length} pieces of negative feedback intercepted before they ` +
        `reached Google reviews (across ${paying.length} customers)."`,
    );
  }
  if (ttf.length >= 3 && median(ttf) <= 24) {
    suggestions.push(
      `"Median time from signup to first guest tap: ${fmt(median(ttf), 1)} hours."`,
    );
  }

  if (suggestions.length === 0) {
    console.log(
      '  Not enough data yet to back any specific marketing claim with confidence.',
    );
    console.log(
      '  Recommend sticking to qualitative copy until customer/review counts grow.',
    );
  } else {
    suggestions.forEach((s) => console.log(`  • ${s}`));
  }

  // Save to JSON
  const out = {
    generatedAt: new Date().toISOString(),
    suggestions,
    stats: allStats,
    rawUplifts: uplifts,
  };
  const outPath = join(__dirname, 'marketing-stats.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n  JSON snapshot saved to: ${outPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

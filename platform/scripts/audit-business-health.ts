/**
 * Business health audit: three cohort queries.
 *
 * 1. Signup → first review latency per paying restaurant
 * 2. Reviews-per-restaurant distribution (not average — the shape)
 * 3. Star rating distribution across all reviews (threshold split)
 *
 * Usage: npx tsx scripts/audit-business-health.ts
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

async function main() {
  const { db } = await import('../src/db');
  const { restaurants, reviews } = await import('../src/db/schema');
  const { sql, inArray, eq } = await import('drizzle-orm');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  BUSINESS HEALTH AUDIT');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── Scope: paying restaurants only (active + past_due + trialing) ──────────
  const payingRows = await db
    .select({
      id:                 restaurants.id,
      name:               restaurants.name,
      slug:               restaurants.slug,
      subscriptionStatus: restaurants.subscriptionStatus,
      googleThreshold:    restaurants.googleThreshold,
      createdAt:          restaurants.createdAt,
    })
    .from(restaurants)
    .where(sql`subscription_status IN ('active', 'trialing', 'past_due')`);

  const payingIds = payingRows.map((r) => r.id);
  const thresholdMap = new Map(payingRows.map((r) => [r.id, r.googleThreshold]));
  const nameMap      = new Map(payingRows.map((r) => [r.id, r.name]));
  const signupMap    = new Map(payingRows.map((r) => [r.id, r.createdAt]));

  console.log(`Paying restaurants in scope: ${payingRows.length}\n`);

  if (payingIds.length === 0) {
    console.log('No paying restaurants found.');
    return;
  }

  // ── 1. Signup → first review latency ──────────────────────────────────────
  console.log('──────────────────────────────────────────────────────────');
  console.log('  1. Signup → First Review Latency');
  console.log('──────────────────────────────────────────────────────────');

  const firstReviews = await db
    .select({
      restaurantId: reviews.restaurantId,
      firstReview:  sql<string>`min(${reviews.createdAt})`,
    })
    .from(reviews)
    .where(inArray(reviews.restaurantId, payingIds))
    .groupBy(reviews.restaurantId);

  const firstReviewMap = new Map(firstReviews.map((r) => [r.restaurantId, r.firstReview]));

  let neverReviewed = 0;
  const latencies: number[] = [];

  for (const r of payingRows) {
    const first = firstReviewMap.get(r.id);
    const signup = r.createdAt;
    if (!first || !signup) {
      neverReviewed++;
      console.log(`  [${String(r.id).padStart(4)}] ${r.name.padEnd(30)} NO REVIEWS YET  ⚠️`);
    } else {
      const days = Math.floor(
        (new Date(first).getTime() - new Date(signup).getTime()) / (1000 * 60 * 60 * 24),
      );
      latencies.push(days);
      const flag = days <= 3 ? '✓' : days <= 7 ? '~' : '⚠️ slow';
      console.log(
        `  [${String(r.id).padStart(4)}] ${r.name.padEnd(30)} first review in ${String(days).padStart(3)} day(s)  ${flag}`,
      );
    }
  }

  if (latencies.length > 0) {
    const median = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
    const avg    = Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length);
    console.log(`\n  Median days to first review: ${median}`);
    console.log(`  Average days to first review: ${avg}`);
  }
  console.log(`  Paying restaurants with ZERO reviews: ${neverReviewed} of ${payingRows.length}`);

  // ── 2. Reviews-per-restaurant distribution ────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  2. Reviews-per-Restaurant Distribution');
  console.log('──────────────────────────────────────────────────────────');

  const reviewCounts = await db
    .select({
      restaurantId: reviews.restaurantId,
      total:        sql<number>`count(*)`,
      lastReview:   sql<string>`max(${reviews.createdAt})`,
    })
    .from(reviews)
    .where(inArray(reviews.restaurantId, payingIds))
    .groupBy(reviews.restaurantId);

  const countMap = new Map(reviewCounts.map((r) => [r.restaurantId, { total: Number(r.total), lastReview: r.lastReview }]));

  // Sort by total desc for readability
  const sorted = [...payingRows].sort((a, b) => {
    const ca = countMap.get(a.id)?.total ?? 0;
    const cb = countMap.get(b.id)?.total ?? 0;
    return cb - ca;
  });

  let totalAllReviews = 0;
  for (const r of sorted) {
    const data      = countMap.get(r.id);
    const count     = data?.total ?? 0;
    const lastStr   = data?.lastReview
      ? new Date(data.lastReview).toISOString().slice(0, 10)
      : 'never';
    const bar       = '█'.repeat(Math.min(40, Math.round(count / 2)));
    const flag      = count === 0 ? '⚠️  GHOST' : count < 5 ? '⚠️  low' : '';
    totalAllReviews += count;
    console.log(`  ${r.name.padEnd(30)} ${String(count).padStart(4)} reviews  last: ${lastStr}  ${bar} ${flag}`);
  }

  const buckets = { zero: 0, low1to9: 0, mid10to49: 0, high50plus: 0 };
  for (const r of payingRows) {
    const c = countMap.get(r.id)?.total ?? 0;
    if (c === 0)        buckets.zero++;
    else if (c < 10)    buckets.low1to9++;
    else if (c < 50)    buckets.mid10to49++;
    else                buckets.high50plus++;
  }

  console.log(`\n  Total reviews across all paying restaurants: ${totalAllReviews}`);
  console.log(`  Avg reviews / restaurant: ${Math.round(totalAllReviews / payingRows.length)}`);
  console.log(`  Buckets:`);
  console.log(`    0 reviews (ghost accounts):  ${buckets.zero}`);
  console.log(`    1–9 reviews (light):         ${buckets.low1to9}`);
  console.log(`    10–49 reviews (moderate):    ${buckets.mid10to49}`);
  console.log(`    50+ reviews (healthy):       ${buckets.high50plus}`);

  // ── 3. Star rating distribution (threshold split) ─────────────────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  3. Star Rating Distribution (all paying restaurants)');
  console.log('──────────────────────────────────────────────────────────');

  const ratingDist = await db
    .select({
      rating: reviews.rating,
      count:  sql<number>`count(*)`,
    })
    .from(reviews)
    .where(inArray(reviews.restaurantId, payingIds))
    .groupBy(reviews.rating)
    .orderBy(sql`rating desc`);

  const total = ratingDist.reduce((s, r) => s + Number(r.count), 0);
  for (const row of ratingDist) {
    const n    = Number(row.count);
    const pct  = total > 0 ? Math.round((n / total) * 100) : 0;
    const bar  = '█'.repeat(Math.round(pct / 2));
    console.log(`  ${row.rating}★  ${String(n).padStart(5)}  (${String(pct).padStart(3)}%)  ${bar}`);
  }

  // Threshold split (using default threshold of 4 to keep it simple)
  const DEFAULT_THRESHOLD = 4;
  const toGoogle  = ratingDist.filter((r) => r.rating >= DEFAULT_THRESHOLD).reduce((s, r) => s + Number(r.count), 0);
  const captured  = ratingDist.filter((r) => r.rating < DEFAULT_THRESHOLD).reduce((s, r) => s + Number(r.count), 0);
  const googlePct = total > 0 ? Math.round((toGoogle / total) * 100) : 0;

  console.log(`\n  At threshold ≥ ${DEFAULT_THRESHOLD}★:`);
  console.log(`    Redirected to Google:  ${toGoogle}  (${googlePct}%)`);
  console.log(`    Captured as private:   ${captured}  (${100 - googlePct}%)`);

  if (googlePct < 50) {
    console.log(`\n  ⚠️  Less than half of reviews are hitting Google.`);
    console.log(`      This is either a service-quality signal or a threshold-too-high signal.`);
    console.log(`      Check per-restaurant breakdown to distinguish.`);
  } else if (googlePct >= 80) {
    console.log(`\n  ✓  ${googlePct}% hitting Google — product is routing correctly.`);
  }

  // Per-restaurant Google redirect rate
  console.log('\n  Per-restaurant Google redirect rate:');
  for (const r of sorted) {
    const perRest = await db
      .select({
        rating: reviews.rating,
        count:  sql<number>`count(*)`,
      })
      .from(reviews)
      .where(sql`${reviews.restaurantId} = ${r.id}`)
      .groupBy(reviews.rating);

    const tot       = perRest.reduce((s, x) => s + Number(x.count), 0);
    const threshold = thresholdMap.get(r.id) ?? DEFAULT_THRESHOLD;
    const toG       = perRest.filter((x) => x.rating >= threshold).reduce((s, x) => s + Number(x.count), 0);
    const pct       = tot > 0 ? Math.round((toG / tot) * 100) : null;
    const pctStr    = pct === null ? 'n/a' : `${pct}%`;
    const flag      = pct === null ? '' : pct < 40 ? '⚠️' : pct >= 80 ? '✓' : '';
    console.log(`  ${r.name.padEnd(30)} ${pctStr.padStart(5)} to Google  (threshold: ${threshold}★, ${tot} reviews)  ${flag}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

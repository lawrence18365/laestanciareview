import { db } from '@/db';
import { restaurants, googleRatingSnapshots } from '@/db/schema';
import { eq, sql, asc, desc, inArray } from 'drizzle-orm';
import { startOfTodayMexico } from '@/lib/mexico-tz';

/**
 * Fetch a restaurant's current Google rating and review count
 * from the Google Places API.
 */
export async function fetchGoogleRating(placeId: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total&key=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 'OK' || !data.result) return null;

  return {
    rating: data.result.rating as number,
    reviewCount: data.result.user_ratings_total as number,
  };
}

/**
 * Refresh the cached Google rating for a single restaurant.
 * Saves a snapshot for historical tracking.
 * Only fetches if the Place ID is set and the cache is older than `maxAgeMs`.
 */
export async function refreshGoogleRating(
  restaurantId: number,
  placeId: string,
  maxAgeMs = 60 * 60 * 1000,
  lastUpdated?: Date | null,
) {
  if (lastUpdated && Date.now() - lastUpdated.getTime() < maxAgeMs) {
    return false;
  }

  const result = await fetchGoogleRating(placeId);
  if (!result) return false;

  const ratingStr = result.rating.toString();

  // Update cached values on restaurant
  await db
    .update(restaurants)
    .set({
      googleRating: ratingStr,
      googleReviewCount: result.reviewCount,
      googleRatingUpdatedAt: new Date(),
    })
    .where(eq(restaurants.id, restaurantId));

  // Save a daily snapshot (only one per day) — use INSERT ... ON CONFLICT
  // to avoid race conditions between concurrent processes
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existingToday = await db
    .select({ id: googleRatingSnapshots.id })
    .from(googleRatingSnapshots)
    .where(
      sql`${googleRatingSnapshots.restaurantId} = ${restaurantId}
          AND ${googleRatingSnapshots.capturedAt} >= ${todayStart}`,
    )
    .limit(1);

  if (existingToday.length === 0) {
    try {
      await db.insert(googleRatingSnapshots).values({
        restaurantId,
        rating: ratingStr,
        reviewCount: result.reviewCount,
      });
    } catch {
      // Ignore duplicate insert from concurrent request
    }
  }

  return true;
}

/**
 * Refresh Google ratings for ALL restaurants that have a Place ID set.
 */
export async function refreshAllGoogleRatings(maxAgeMs = 60 * 60 * 1000) {
  const rows = await db
    .select({
      id: restaurants.id,
      placeId: restaurants.googlePlaceId,
      lastUpdated: restaurants.googleRatingUpdatedAt,
    })
    .from(restaurants)
    .where(sql`${restaurants.googlePlaceId} is not null`);

  let updated = 0;
  for (const row of rows) {
    if (!row.placeId) continue;
    const didUpdate = await refreshGoogleRating(
      row.id,
      row.placeId,
      maxAgeMs,
      row.lastUpdated,
    );
    if (didUpdate) updated++;
  }

  return { total: rows.length, updated };
}

/**
 * Get the first-ever snapshot (baseline / "pre-RateTap" score)
 * and the latest snapshot for a restaurant.
 */
export async function getGoogleRatingTrend(restaurantId: number) {
  const [firstRows, latestRows] = await Promise.all([
    db
      .select()
      .from(googleRatingSnapshots)
      .where(eq(googleRatingSnapshots.restaurantId, restaurantId))
      .orderBy(asc(googleRatingSnapshots.capturedAt))
      .limit(1),
    db
      .select()
      .from(googleRatingSnapshots)
      .where(eq(googleRatingSnapshots.restaurantId, restaurantId))
      .orderBy(desc(googleRatingSnapshots.capturedAt))
      .limit(1),
  ]);

  const first = firstRows[0] ?? null;
  const latest = latestRows[0] ?? null;

  if (!first || !latest) return null;

  return {
    baselineRating: parseFloat(first.rating),
    baselineReviewCount: first.reviewCount,
    baselineDate: first.capturedAt,
    currentRating: parseFloat(latest.rating),
    currentReviewCount: latest.reviewCount,
    currentDate: latest.capturedAt,
    ratingChange: parseFloat(latest.rating) - parseFloat(first.rating),
    reviewsGained: latest.reviewCount - first.reviewCount,
  };
}

/**
 * Google reviews added today: live cached count minus the most recent
 * snapshot captured before Mexico-midnight today. Returns null when there's
 * no prior snapshot to diff against.
 */
export async function getGoogleReviewsAddedToday(
  restaurantId: number,
  currentCount: number | null,
): Promise<number | null> {
  if (currentCount == null) return null;

  const todayStart = startOfTodayMexico();
  const rows = await db
    .select({ reviewCount: googleRatingSnapshots.reviewCount })
    .from(googleRatingSnapshots)
    .where(
      sql`${googleRatingSnapshots.restaurantId} = ${restaurantId}
          AND ${googleRatingSnapshots.capturedAt} < ${todayStart}`,
    )
    .orderBy(desc(googleRatingSnapshots.capturedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const diff = currentCount - rows[0].reviewCount;
  return diff < 0 ? 0 : diff;
}

/**
 * Get all Google rating snapshots for charting over time.
 */
export async function getGoogleRatingHistory(restaurantId: number) {
  return db
    .select({
      rating: googleRatingSnapshots.rating,
      reviewCount: googleRatingSnapshots.reviewCount,
      date: googleRatingSnapshots.capturedAt,
    })
    .from(googleRatingSnapshots)
    .where(eq(googleRatingSnapshots.restaurantId, restaurantId))
    .orderBy(asc(googleRatingSnapshots.capturedAt));
}

/**
 * Get Google rating trends for multiple restaurants at once.
 */
export async function getGoogleRatingTrendBatch(restaurantIds: number[]) {
  const results: Record<number, Awaited<ReturnType<typeof getGoogleRatingTrend>>> = {};
  await Promise.all(
    restaurantIds.map(async (id) => {
      results[id] = await getGoogleRatingTrend(id);
    }),
  );
  return results;
}

/**
 * Seeds realistic Google rating test data for all restaurants.
 * This lets you verify the UI without a working Google Places API key.
 *
 * Usage: npx tsx src/db/seed-google-test-data.ts
 * To remove: npx tsx src/db/seed-google-test-data.ts --clean
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants, googleRatingSnapshots } from './schema';
import { eq, sql, isNotNull } from 'drizzle-orm';

// Realistic baseline → current ratings for each restaurant
const testData: Record<string, { baseline: number; current: number; baseReviews: number; currentReviews: number }> = {
  'estancia-angelopolis':   { baseline: 4.2, current: 4.5, baseReviews: 312, currentReviews: 387 },
  'estancia-juarez':        { baseline: 4.0, current: 4.3, baseReviews: 198, currentReviews: 245 },
  'estancia-veracruz':      { baseline: 4.3, current: 4.5, baseReviews: 156, currentReviews: 201 },
  'estancia-xalapa':        { baseline: 4.1, current: 4.4, baseReviews: 89,  currentReviews: 127 },
  'estancia-queretaro':     { baseline: 4.4, current: 4.6, baseReviews: 220, currentReviews: 278 },
  'estancia-leon':          { baseline: 4.1, current: 4.4, baseReviews: 175, currentReviews: 234 },
  'la-silla-juarez':        { baseline: 4.0, current: 4.2, baseReviews: 143, currentReviews: 189 },
  'la-silla-huexotitla':    { baseline: 3.9, current: 4.3, baseReviews: 97,  currentReviews: 134 },
  'harbors-angelopolis':    { baseline: 4.3, current: 4.6, baseReviews: 267, currentReviews: 321 },
  'harbors-veracruz':       { baseline: 4.2, current: 4.4, baseReviews: 134, currentReviews: 178 },
  'steakcompany-queretaro': { baseline: 4.1, current: 4.5, baseReviews: 189, currentReviews: 241 },
  'regio-norte':            { baseline: 4.0, current: 4.3, baseReviews: 76,  currentReviews: 112 },
};

async function seedTestData() {
  const clean = process.argv.includes('--clean');
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient);

  // Get all restaurants with Place IDs
  const allRestaurants = await db
    .select({ id: restaurants.id, slug: restaurants.slug, name: restaurants.name })
    .from(restaurants)
    .where(isNotNull(restaurants.googlePlaceId));

  if (clean) {
    console.log('Cleaning test Google rating data...\n');
    for (const r of allRestaurants) {
      await db.delete(googleRatingSnapshots).where(eq(googleRatingSnapshots.restaurantId, r.id));
      await db.update(restaurants).set({
        googleRating: null,
        googleReviewCount: null,
        googleRatingUpdatedAt: null,
      }).where(eq(restaurants.id, r.id));
      console.log(`  Cleaned ${r.name}`);
    }
    console.log('\nDone! All test data removed.');
    return;
  }

  console.log('Seeding test Google rating data...\n');

  for (const r of allRestaurants) {
    const data = testData[r.slug];
    if (!data) continue;

    // Delete existing snapshots for clean test
    await db.delete(googleRatingSnapshots).where(eq(googleRatingSnapshots.restaurantId, r.id));

    // Generate ~12 weekly snapshots showing gradual improvement
    const now = new Date();
    const weeks = 12;
    const ratingStep = (data.current - data.baseline) / weeks;
    const reviewStep = Math.round((data.currentReviews - data.baseReviews) / weeks);

    for (let w = weeks; w >= 0; w--) {
      const date = new Date(now);
      date.setDate(date.getDate() - w * 7);
      // Add slight randomness to make it look natural
      const jitter = (Math.random() - 0.5) * 0.05;
      const rating = Math.min(5, Math.max(1, data.baseline + ratingStep * (weeks - w) + jitter));
      const reviewCount = data.baseReviews + reviewStep * (weeks - w) + Math.round(Math.random() * 3);

      await db.insert(googleRatingSnapshots).values({
        restaurantId: r.id,
        rating: rating.toFixed(1),
        reviewCount: Math.round(reviewCount),
        capturedAt: date,
      });
    }

    // Update cached values on restaurant row
    await db.update(restaurants).set({
      googleRating: data.current.toFixed(1),
      googleReviewCount: data.currentReviews,
      googleRatingUpdatedAt: now,
    }).where(eq(restaurants.id, r.id));

    const change = (data.current - data.baseline).toFixed(1);
    const gained = data.currentReviews - data.baseReviews;
    console.log(`  ${r.name}: ${data.baseline} → ${data.current} ★ (+${change}) | ${data.baseReviews} → ${data.currentReviews} reviews (+${gained})`);
  }

  console.log('\nTest data seeded! Check these pages:');
  console.log('  1. /dashboard   — Hero rating card + trend chart');
  console.log('  2. /analytics   — Impact banner with baseline → current');
  console.log('  3. /live        — Google Rating Card (SENTIMIENTO GLOBAL)');
  console.log('  4. /overview    — Owner table with all locations + portfolio totals');
}

seedTestData().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});

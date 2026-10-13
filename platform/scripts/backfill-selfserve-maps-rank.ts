/**
 * One-off: give existing self-serve restaurants (group_key NULL) their one
 * category+city Maps rank keyword and run a single sweep for each (about 10
 * Places calls per restaurant). Skips restaurants that already have a keyword.
 * Dry run by default. Pass --apply to insert and sweep (the sweep also needs
 * MAPS_RANK_ENABLED=true and GOOGLE_PLACES_API_KEY).
 */
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

async function main() {
  // Imported after dotenv so DATABASE_URL is set when the db client initializes.
  const { db } = await import('@/db');
  const { restaurants, mapsRankKeywords } = await import('@/db/schema');
  const { and, eq, isNotNull, isNull } = await import('drizzle-orm');
  const { defaultKeywords } = await import('@/lib/maps-rank-keywords');
  const { runMapsRankSweep } = await import('@/lib/maps-rank');

  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      googleProfile: restaurants.googleProfile,
    })
    .from(restaurants)
    .where(
      and(
        isNull(restaurants.groupKey),
        isNotNull(restaurants.googlePlaceId),
        isNotNull(restaurants.city),
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    );

  const have = new Set(
    (await db.select({ id: mapsRankKeywords.restaurantId }).from(mapsRankKeywords)).map((k) => k.id),
  );

  const plan = rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      keywords: defaultKeywords({ city: r.city, brand: null, groupKey: null, googleProfile: r.googleProfile }),
    }))
    .filter((r) => r.keywords.length > 0);

  for (const r of plan) {
    console.log(`${r.id}\t${r.name}\t${r.keywords.join(' | ')}`);
  }
  console.log(`${plan.length} restaurants, ${plan.reduce((n, r) => n + r.keywords.length, 0)} keywords`);

  if (!apply) {
    console.log('Dry run. Pass --apply to insert and sweep.');
    return;
  }

  const values = plan.flatMap((r) =>
    r.keywords.map((keyword) => ({ restaurantId: r.id, keyword })),
  );
  if (values.length > 0) {
    await db.insert(mapsRankKeywords).values(values).onConflictDoNothing();
  }
  console.log(`Applied ${values.length} keyword rows (conflicts skipped).`);

  if (process.env.MAPS_RANK_ENABLED !== 'true') {
    console.log('MAPS_RANK_ENABLED is not true: keywords saved, no sweep run.');
    return;
  }
  for (const r of plan) {
    const result = await runMapsRankSweep({ restaurantId: r.id, force: true });
    console.log(`${r.id}\tsamples=${result.samples}\tfailed=${result.failed}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

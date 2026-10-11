/**
 * Seed default Maps rank keywords for restaurants with a Place ID and a city.
 * Dry run by default. Pass --apply to insert. Existing keywords are left alone.
 */
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

async function main() {
  // Imported after dotenv so DATABASE_URL is set when the db client initializes.
  const { db } = await import('@/db');
  const { restaurants, mapsRankKeywords } = await import('@/db/schema');
  const { and, eq, isNotNull } = await import('drizzle-orm');
  const { defaultKeywords } = await import('@/lib/maps-rank-keywords');

  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      brand: restaurants.brand,
    })
    .from(restaurants)
    .where(
      and(
        isNotNull(restaurants.googlePlaceId),
        isNotNull(restaurants.city),
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    );

  const plan = rows
    .map((r) => ({ id: r.id, name: r.name, keywords: defaultKeywords(r) }))
    .filter((r) => r.keywords.length > 0);

  for (const r of plan) {
    console.log(`${r.id}\t${r.name}\t${r.keywords.join(' | ')}`);
  }
  console.log(`${plan.length} restaurants, ${plan.reduce((n, r) => n + r.keywords.length, 0)} keywords`);

  if (!apply) {
    console.log('Dry run. Pass --apply to insert.');
    return;
  }

  const values = plan.flatMap((r) =>
    r.keywords.map((keyword) => ({ restaurantId: r.id, keyword })),
  );
  if (values.length > 0) {
    await db.insert(mapsRankKeywords).values(values).onConflictDoNothing();
  }
  console.log(`Applied ${values.length} keyword rows (conflicts skipped).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * One-off backfill (SQ-214): recompute `google_profile.competitors` for
 * self-serve restaurants with the comparable-places selection (same category,
 * similar size, no national chains) instead of the old "top 3 by review count".
 *
 * Dry-run by default: prints old vs new names, writes nothing.
 * With --apply: replaces ONLY the `competitors` key of `google_profile` (a
 * jsonb_set, so goal, chainCount, fetchedAt and every other key stay as is).
 *
 * Costs up to two legacy Nearby Search calls per restaurant (about US$0.04).
 * Group restaurants (group_key set) are never touched. Restaurants whose
 * profile has no stored coordinates are skipped.
 *
 * Usage:
 *   npx tsx scripts/refresh-competitors.ts            # dry run
 *   npx tsx scripts/refresh-competitors.ts --apply    # write
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

const APPLY = process.argv.includes('--apply');
const DELAY_MS = 250;

async function main() {
  const [{ db }, { restaurants }, { findComparableCompetitors }, { parseGoogleProfile }, orm] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/schema'),
      import('../src/lib/competitors'),
      import('../src/lib/onboarding-profile'),
      import('drizzle-orm'),
    ]);
  const { and, eq, isNotNull, isNull, sql } = orm;

  const rows = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      googlePlaceId: restaurants.googlePlaceId,
      googleReviewCount: restaurants.googleReviewCount,
      googleProfile: restaurants.googleProfile,
    })
    .from(restaurants)
    .where(
      and(
        isNull(restaurants.groupKey),
        isNotNull(restaurants.googlePlaceId),
        isNotNull(restaurants.googleProfile),
      ),
    );

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} self-serve restaurant(s) with a place ID.`);

  let changed = 0;
  for (const r of rows) {
    if (!r.googlePlaceId) continue;
    const profile = parseGoogleProfile(r.googleProfile);
    if (!profile || profile.lat === null || profile.lng === null) {
      console.log(`${r.slug}\tskipped (no stored location)`);
      continue;
    }
    let next;
    try {
      next = await findComparableCompetitors(profile.lat, profile.lng, r.googlePlaceId, {
        reviewCount: r.googleReviewCount,
        primaryType: profile.primaryType,
        types: profile.types,
      });
    } catch (err) {
      console.log(`${r.slug}\tskipped (Places error: ${err instanceof Error ? err.message : 'unknown'})`);
      continue;
    }
    const fmt = (list: { name: string; reviewCount: number }[]) =>
      list.map((c) => `${c.name} (${c.reviewCount})`).join(', ') || 'none';
    console.log(`${r.slug}\n  old: ${fmt(profile.competitors)}\n  new: ${fmt(next)}`);

    if (APPLY && next.length > 0) {
      await db
        .update(restaurants)
        .set({
          googleProfile: sql`jsonb_set(${restaurants.googleProfile}, '{competitors}', ${JSON.stringify(next)}::jsonb)`,
        })
        .where(eq(restaurants.id, r.id));
      changed++;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  console.log(`Done. ${APPLY ? `${changed} updated.` : 'Dry run: nothing written.'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

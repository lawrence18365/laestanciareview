/**
 * Backfill: derive googleReviewUrl from googlePlaceId for every restaurant
 * that has a Place ID stored but is missing the review URL.
 *
 * Root cause: the Stripe webhook was not deriving googleReviewUrl at signup
 * time, so all restaurants provisioned before the fix have a null URL even
 * though their Place ID was captured correctly.
 *
 * This script is idempotent — rows that already have a googleReviewUrl are
 * untouched regardless of whether they have a Place ID.
 *
 * Usage (from /platform):
 *   npx tsx scripts/backfill-google-review-url.ts
 *
 * Dry-run (no writes):
 *   DRY_RUN=true npx tsx scripts/backfill-google-review-url.ts
 */

import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  const { db } = await import('../src/db');
  const { restaurants } = await import('../src/db/schema');
  const { isNotNull, isNull, sql } = await import('drizzle-orm');

  // ── 1. Audit: count affected rows ─────────────────────────────────────────
  const affected = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      managerEmail: restaurants.managerEmail,
      googlePlaceId: restaurants.googlePlaceId,
      subscriptionStatus: restaurants.subscriptionStatus,
      createdAt: restaurants.createdAt,
    })
    .from(restaurants)
    .where(
      sql`${restaurants.googlePlaceId} IS NOT NULL AND ${restaurants.googleReviewUrl} IS NULL`,
    );

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  BACKFILL: googleReviewUrl ← googlePlaceId');
  console.log('══════════════════════════════════════════════════════');
  console.log(`\nAffected restaurants: ${affected.length}`);

  if (affected.length === 0) {
    console.log('Nothing to backfill. All done.\n');
    return;
  }

  console.log('\nAffected rows:');
  for (const r of affected) {
    const derivedUrl = `https://search.google.com/local/writereview?placeid=${r.googlePlaceId}`;
    console.log(
      `  [${String(r.id).padStart(4)}] ${r.name} (${r.slug})`
        + ` | status: ${r.subscriptionStatus}`
        + ` | signed up: ${r.createdAt?.toISOString().slice(0, 10)}`
        + `\n           → ${derivedUrl}`,
    );
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No writes performed. Set DRY_RUN=false to apply.\n');
    return;
  }

  // ── 2. Update each affected row ───────────────────────────────────────────
  let updated = 0;
  for (const r of affected) {
    const derivedUrl = `https://search.google.com/local/writereview?placeid=${r.googlePlaceId}`;
    await db
      .update(restaurants)
      .set({ googleReviewUrl: derivedUrl })
      .where(sql`${restaurants.id} = ${r.id}`);
    updated++;
    console.log(`  ✓ Updated restaurant ${r.id} (${r.name})`);
  }

  console.log(`\nBackfill complete: ${updated}/${affected.length} rows updated.\n`);
}

main().catch((err) => {
  console.error('\n[ERROR]', err);
  process.exit(1);
});

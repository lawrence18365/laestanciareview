/**
 * Audit: counts of Google-field states across all restaurant rows.
 * Usage: npx tsx scripts/audit-google-fields.ts
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

async function main() {
  const { db } = await import('../src/db');
  const { restaurants } = await import('../src/db/schema');
  const { sql } = await import('drizzle-orm');

  const [counts] = await db
    .select({
      total:           sql<number>`count(*)`,
      hasPlaceId:      sql<number>`count(*) filter (where google_place_id is not null)`,
      hasReviewUrl:    sql<number>`count(*) filter (where google_review_url is not null)`,
      broken:          sql<number>`count(*) filter (where google_place_id is not null and google_review_url is null)`,
      noGoogleAtAll:   sql<number>`count(*) filter (where google_place_id is null and google_review_url is null)`,
    })
    .from(restaurants);

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  AUDIT: Google field states across restaurants table');
  console.log('══════════════════════════════════════════════════════\n');
  console.log(`  Total restaurants:                  ${counts.total}`);
  console.log(`  Has google_place_id:                ${counts.hasPlaceId}`);
  console.log(`  Has google_review_url:              ${counts.hasReviewUrl}`);
  console.log(`  ⚠️  BROKEN (place_id ✓, url ✗):    ${counts.broken}  ← blast radius`);
  console.log(`  No Google data at all:              ${counts.noGoogleAtAll}`);
  console.log('');

  if (Number(counts.broken) > 0) {
    console.log('  Affected rows:');
    const affected = await db
      .select({
        id:                 restaurants.id,
        name:               restaurants.name,
        slug:               restaurants.slug,
        managerEmail:       restaurants.managerEmail,
        googlePlaceId:      restaurants.googlePlaceId,
        subscriptionStatus: restaurants.subscriptionStatus,
        createdAt:          restaurants.createdAt,
      })
      .from(restaurants)
      .where(sql`google_place_id is not null and google_review_url is null`);

    for (const r of affected) {
      console.log(
        `\n  [${String(r.id).padStart(4)}] ${r.name}`
        + `\n         slug:    ${r.slug}`
        + `\n         email:   ${r.managerEmail}`
        + `\n         status:  ${r.subscriptionStatus}`
        + `\n         signed:  ${r.createdAt?.toISOString().slice(0, 10)}`
        + `\n         url →    https://search.google.com/local/writereview?placeid=${r.googlePlaceId}`,
      );
    }
  } else {
    console.log('  No broken rows — all restaurants with a Place ID also have a Review URL.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

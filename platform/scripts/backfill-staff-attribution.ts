/**
 * Deterministically attribute unattributed reviews to an existing staff row.
 *
 * Dry run (default):
 *   npx tsx scripts/backfill-staff-attribution.ts
 *
 * Apply after migration 0019 exists:
 *   npx tsx scripts/backfill-staff-attribution.ts --apply
 */

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

const APPLY = process.argv.includes('--apply');

let skippedConcurrent = 0;
let skippedAlreadyDone = 0;

type CandidateRow = {
  review_id: number | string;
  restaurant_id: number | string;
  restaurant_name: string;
  old_staff_id: number | string | null;
  old_staff_name: string | null;
  original_staff_code: string;
  matched_code: string;
  match_count: number | string;
  new_staff_id: number | string | null;
  new_staff_name: string | null;
};

type PlannedChange = {
  reviewId: number;
  restaurantId: number;
  restaurantName: string;
  oldStaffId: number | null;
  oldStaffName: string | null;
  originalStaffCode: string;
  matchedCode: string;
  newStaffId: number;
  newStaffName: string;
};

type RestaurantSummary = {
  restaurant: string;
  candidates: number;
  planned: number;
  noMatch: number;
  ambiguous: number;
};

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

async function applyChanges(planned: PlannedChange[]): Promise<number> {
  const { transactionDb } = await import('../src/db');
  const { reviews, staffAttributionBackfill } = await import('../src/db/schema');
  const { and, eq, inArray, isNull } = await import('drizzle-orm');

  let applied = 0;
  skippedConcurrent = 0;
  skippedAlreadyDone = 0;

  await transactionDb.transaction(async (tx) => {
    const previouslyAudited = planned.length === 0
      ? []
      : await tx
        .select({ reviewId: staffAttributionBackfill.reviewId })
        .from(staffAttributionBackfill)
        .where(inArray(
          staffAttributionBackfill.reviewId,
          planned.map((change) => change.reviewId),
        ));
    const auditedReviewIds = new Set(
      previouslyAudited.map((row) => row.reviewId),
    );

    for (const change of planned) {
      if (auditedReviewIds.has(change.reviewId)) {
        skippedAlreadyDone++;
        continue;
      }

      const updated = await tx
        .update(reviews)
        .set({
          staffId: change.newStaffId,
          staffName: change.newStaffName,
        })
        .where(and(
          eq(reviews.id, change.reviewId),
          isNull(reviews.staffId),
        ))
        .returning({ id: reviews.id });

      if (updated.length === 0) {
        skippedConcurrent++;
        continue;
      }

      await tx.insert(staffAttributionBackfill).values({
        reviewId: change.reviewId,
        restaurantId: change.restaurantId,
        oldStaffId: change.oldStaffId,
        oldStaffName: change.oldStaffName,
        newStaffId: change.newStaffId,
        newStaffName: change.newStaffName,
        matchedCode: change.matchedCode,
        originalStaffCode: change.originalStaffCode,
      });
      applied++;
    }
  });

  return applied;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.replace(/\\n/g, '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL missing');

  const client = neon(databaseUrl);
  const auditCheck = (await client`
    SELECT to_regclass('public.staff_attribution_backfill') IS NOT NULL AS audit_exists
  `) as Array<{ audit_exists: boolean }>;
  const auditExists = auditCheck[0]?.audit_exists === true;

  if (APPLY && !auditExists) {
    throw new Error(
      'staff_attribution_backfill does not exist; apply migration 0019 before --apply',
    );
  }

  // Do not reference the audit table at all until to_regclass confirms it
  // exists, so the default dry run works before migration 0019 is applied.
  const priorAuditExclusion = auditExists
    ? `AND NOT EXISTS (
         SELECT 1
         FROM staff_attribution_backfill audit
         WHERE audit.review_id = r.id
       )`
    : '';

  const rows = (await client.query(`
    SELECT
      r.id AS review_id,
      r.restaurant_id,
      restaurant.name AS restaurant_name,
      r.staff_id AS old_staff_id,
      r.staff_name AS old_staff_name,
      r.staff_code AS original_staff_code,
      lower(btrim(r.staff_code)) AS matched_code,
      count(s.id)::integer AS match_count,
      min(s.id)::integer AS new_staff_id,
      min(s.name) AS new_staff_name
    FROM reviews r
    INNER JOIN restaurants restaurant
      ON restaurant.id = r.restaurant_id
    LEFT JOIN staff s
      ON s.restaurant_id = r.restaurant_id
     AND lower(btrim(s.code)) = lower(btrim(r.staff_code))
    WHERE r.staff_id IS NULL
      AND r.staff_code IS NOT NULL
      AND btrim(r.staff_code) <> ''
      ${priorAuditExclusion}
    GROUP BY
      r.id,
      r.restaurant_id,
      restaurant.name,
      r.staff_id,
      r.staff_name,
      r.staff_code
    ORDER BY restaurant.name, r.restaurant_id, r.id
  `)) as CandidateRow[];

  const planned: PlannedChange[] = [];
  let skippedNoMatch = 0;
  let skippedAmbiguous = 0;
  const restaurantSummary = new Map<number, RestaurantSummary>();

  for (const row of rows) {
    const restaurantId = toNumber(row.restaurant_id);
    const matchCount = toNumber(row.match_count);
    const summary = restaurantSummary.get(restaurantId) ?? {
      restaurant: `${row.restaurant_name} (#${restaurantId})`,
      candidates: 0,
      planned: 0,
      noMatch: 0,
      ambiguous: 0,
    };
    summary.candidates++;

    if (matchCount === 0) {
      skippedNoMatch++;
      summary.noMatch++;
    } else if (matchCount > 1) {
      skippedAmbiguous++;
      summary.ambiguous++;
    } else if (row.new_staff_id !== null && row.new_staff_name !== null) {
      summary.planned++;
      planned.push({
        reviewId: toNumber(row.review_id),
        restaurantId,
        restaurantName: row.restaurant_name,
        oldStaffId: row.old_staff_id === null ? null : toNumber(row.old_staff_id),
        oldStaffName: row.old_staff_name,
        originalStaffCode: row.original_staff_code,
        matchedCode: row.matched_code,
        newStaffId: toNumber(row.new_staff_id),
        newStaffName: row.new_staff_name,
      });
    }

    restaurantSummary.set(restaurantId, summary);
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  STAFF ATTRIBUTION BACKFILL — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('══════════════════════════════════════════════════════');

  if (!APPLY && planned.length > 0) {
    console.log('\nFirst 20 planned changes:');
    for (const change of planned.slice(0, 20)) {
      console.log(
        `  ${change.reviewId} | ${change.restaurantName} | `
          + `${JSON.stringify(change.originalStaffCode)} -> ${change.newStaffName}`,
      );
    }
  }

  const applied = APPLY ? await applyChanges(planned) : 0;
  const perRestaurant = [...restaurantSummary.values()].map((summary) => ({
    restaurant: summary.restaurant,
    candidates: summary.candidates,
    [APPLY ? 'applied' : 'would_apply']: summary.planned,
    no_match: summary.noMatch,
    ambiguous: summary.ambiguous,
  }));

  console.log('\nPer-restaurant summary:');
  console.table(perRestaurant);
  console.log('\nSummary:');
  console.log(`  candidates:         ${rows.length}`);
  console.log(`  ${APPLY ? 'applied' : 'would-apply'}:        ${APPLY ? applied : planned.length}`);
  console.log(`  skipped_no_match:   ${skippedNoMatch}`);
  console.log(`  skipped_ambiguous:  ${skippedAmbiguous}`);
  if (APPLY) {
    console.log(`  skipped_concurrent: ${skippedConcurrent}`);
    console.log(`  skipped_already_done: ${skippedAlreadyDone}`);
  }
  if (!APPLY) console.log('  writes_performed:   0 (dry run)');
}

main().catch((error) => {
  console.error('\n[ERROR]', error);
  process.exitCode = 1;
});

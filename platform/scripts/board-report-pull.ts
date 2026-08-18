/**
 * One-off read-only pull for the Grupo Estancia board report.
 * Per-location all-time captured/routed/private + saved-review examples.
 * Usage: cd platform && npx tsx scripts/board-report-pull.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const perLoc = await pool.query(`
    SELECT r.id, r.name, r.slug, r.created_at::date AS activated,
           r.google_rating, r.google_review_count,
           COUNT(rv.id)::int AS captured,
           SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int AS routed,
           SUM(CASE WHEN NOT rv.sent_to_google THEN 1 ELSE 0 END)::int AS held_private,
           SUM(CASE WHEN rv.rating <= 3 THEN 1 ELSE 0 END)::int AS low_star,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.feedback IS NOT NULL AND length(trim(rv.feedback))>0 THEN 1 ELSE 0 END)::int AS private_with_text
    FROM restaurants r
    LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    WHERE NOT r.is_owner AND NOT r.is_regional
    GROUP BY r.id
    ORDER BY captured DESC
  `);
  console.log('=== PER-LOCATION (all-time) ===');
  console.table(perLoc.rows);

  const totals = await pool.query(`
    SELECT COUNT(*)::int captured,
           SUM(CASE WHEN sent_to_google THEN 1 ELSE 0 END)::int routed,
           SUM(CASE WHEN NOT sent_to_google THEN 1 ELSE 0 END)::int private,
           SUM(CASE WHEN rating<=3 THEN 1 ELSE 0 END)::int low_star,
           SUM(CASE WHEN rating<=3 AND NOT sent_to_google THEN 1 ELSE 0 END)::int low_star_intercepted
    FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT r.is_owner AND NOT r.is_regional
  `);
  console.log('=== GROUP TOTALS ===');
  console.table(totals.rows);

  const stories = await pool.query(`
    SELECT r.name AS location, rv.rating, rv.status,
           rv.created_at::date AS date,
           left(rv.feedback, 400) AS feedback
    FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT rv.sent_to_google
      AND rv.rating <= 3
      AND rv.feedback IS NOT NULL AND length(trim(rv.feedback)) > 25
    ORDER BY rv.created_at DESC
    LIMIT 20
  `);
  console.log(`=== SAVED-REVIEW EXAMPLES (low-star, held private, with text) — ${stories.rows.length} shown ===`);
  for (const s of stories.rows) {
    console.log(`\n[${s.location}] ${s.rating}★ · ${s.date} · status=${s.status}\n  "${s.feedback}"`);
  }

  // resolved private feedback = ops actually closed the loop
  const resolved = await pool.query(`
    SELECT COUNT(*)::int n FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT rv.sent_to_google AND rv.rating<=3 AND rv.status='resolved'
      AND NOT r.is_owner AND NOT r.is_regional
  `);
  console.log('\n=== Low-star private reviews marked RESOLVED by ops ===', resolved.rows[0].n);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

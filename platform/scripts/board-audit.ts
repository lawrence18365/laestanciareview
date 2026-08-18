/**
 * Read-only audit for the board report. Explains the held_private vs low_star gap,
 * per-location threshold/config, and resolved/text breakdowns. No writes.
 * Usage: cd platform && npx tsx scripts/board-audit.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Per-location config + held_private split by rating bucket
  const cfg = await pool.query(`
    SELECT r.name,
           r.google_threshold AS threshold,
           (r.google_review_url IS NOT NULL AND length(trim(r.google_review_url))>0) AS has_google_url,
           COUNT(rv.id)::int AS captured,
           SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int AS routed,
           SUM(CASE WHEN NOT rv.sent_to_google THEN 1 ELSE 0 END)::int AS held_private,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 THEN 1 ELSE 0 END)::int AS priv_le3,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=4 THEN 1 ELSE 0 END)::int AS priv_4,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=5 THEN 1 ELSE 0 END)::int AS priv_5
    FROM restaurants r LEFT JOIN reviews rv ON rv.restaurant_id=r.id
    WHERE NOT r.is_owner AND NOT r.is_regional
    GROUP BY r.id ORDER BY captured DESC
  `);
  console.log('=== PER-LOCATION CONFIG + HELD-PRIVATE BY RATING ===');
  console.table(cfg.rows);

  // 2. Group reconciliation
  const recon = await pool.query(`
    SELECT
      COUNT(*)::int captured,
      SUM(CASE WHEN sent_to_google THEN 1 ELSE 0 END)::int routed,
      SUM(CASE WHEN NOT sent_to_google THEN 1 ELSE 0 END)::int held_private,
      SUM(CASE WHEN NOT sent_to_google AND rating<=3 THEN 1 ELSE 0 END)::int priv_le3,
      SUM(CASE WHEN NOT sent_to_google AND rating=4 THEN 1 ELSE 0 END)::int priv_4,
      SUM(CASE WHEN NOT sent_to_google AND rating=5 THEN 1 ELSE 0 END)::int priv_5
    FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT r.is_owner AND NOT r.is_regional
  `);
  console.log('=== GROUP RECONCILIATION (12 locations, excludes El Braserio/owner/regional) ===');
  console.table(recon.rows);

  // 3. What "resolved" means: status distribution among low-star private
  const status = await pool.query(`
    SELECT rv.status, COUNT(*)::int n
    FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT rv.sent_to_google AND rv.rating<=3 AND NOT r.is_owner AND NOT r.is_regional
    GROUP BY rv.status ORDER BY n DESC
  `);
  console.log('=== LOW-STAR PRIVATE (<=3) BY STATUS ===');
  console.table(status.rows);

  // 4. Low-star private: how many have ANY substantive text (>25 chars) vs blank/short
  const text = await pool.query(`
    SELECT
      COUNT(*)::int total_le3_private,
      SUM(CASE WHEN feedback IS NOT NULL AND length(trim(feedback))>0 THEN 1 ELSE 0 END)::int any_text,
      SUM(CASE WHEN feedback IS NOT NULL AND length(trim(feedback))>25 THEN 1 ELSE 0 END)::int text_gt25,
      SUM(CASE WHEN feedback IS NULL OR length(trim(feedback))=0 THEN 1 ELSE 0 END)::int no_text
    FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT rv.sent_to_google AND rv.rating<=3 AND NOT r.is_owner AND NOT r.is_regional
  `);
  console.log('=== LOW-STAR PRIVATE TEXT COVERAGE ===');
  console.table(text.rows);

  // 5. El Braserio full record (the one external account)
  const braserio = await pool.query(`
    SELECT id,name,subscription_status,
           stripe_subscription_id IS NOT NULL AS has_stripe,
           stripe_customer_id IS NOT NULL AS has_stripe_cust,
           trial_ends_at, created_at, google_review_url IS NOT NULL AS has_google_url
    FROM restaurants WHERE slug='el-braserio'
  `);
  console.log('=== EL BRASERIO (only ever external account) ===');
  console.table(braserio.rows);

  // 6. Any restaurant with a real Stripe subscription id (would = paying)
  const paying = await pool.query(`
    SELECT name, subscription_status, stripe_subscription_id, stripe_customer_id
    FROM restaurants WHERE stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL
  `);
  console.log('=== ACCOUNTS WITH ANY STRIPE ID ===');
  console.table(paying.rows);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

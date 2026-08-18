import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Atomic snapshot: single timestamp for the whole verification
  const snap = await pool.query(`SELECT now() AS ts, (SELECT COUNT(*)::int FROM reviews) AS total_reviews_all_restaurants`);
  console.log('SNAPSHOT TIME:', snap.rows[0].ts, '| total reviews (every restaurant):', snap.rows[0].total_reviews_all_restaurants);

  // Classify every restaurant bucket so nothing is hidden
  const buckets = await pool.query(`
    SELECT
      CASE
        WHEN r.is_owner THEN 'OWNER (excluded)'
        WHEN r.is_regional THEN 'REGIONAL (excluded)'
        WHEN r.slug = 'el-braserio' THEN 'EL BRASERIO (external pilot, broken out)'
        ELSE '12 GROUP LOCATIONS'
      END AS bucket,
      COUNT(DISTINCT r.id)::int AS restaurants,
      COUNT(rv.id)::int AS captured,
      SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int AS routed,
      SUM(CASE WHEN NOT rv.sent_to_google THEN 1 ELSE 0 END)::int AS private,
      SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 THEN 1 ELSE 0 END)::int AS priv_le3,
      SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=4 THEN 1 ELSE 0 END)::int AS priv_4,
      SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=5 THEN 1 ELSE 0 END)::int AS priv_5
    FROM restaurants r LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    GROUP BY 1 ORDER BY captured DESC
  `);
  console.log('\n=== ALL RESTAURANTS CLASSIFIED (nothing hidden) ===');
  console.table(buckets.rows);

  // The 12 group locations ONLY (excl owner, regional, AND el-braserio)
  const g = await pool.query(`
    SELECT COUNT(DISTINCT r.id)::int AS n_locations,
           COUNT(rv.id)::int AS captured,
           SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int AS routed,
           SUM(CASE WHEN NOT rv.sent_to_google THEN 1 ELSE 0 END)::int AS private,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 THEN 1 ELSE 0 END)::int AS priv_le3,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=4 THEN 1 ELSE 0 END)::int AS priv_4,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating=5 THEN 1 ELSE 0 END)::int AS priv_5,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 AND rv.feedback IS NOT NULL AND length(trim(rv.feedback))>0 THEN 1 ELSE 0 END)::int AS le3_any_text,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 AND rv.feedback IS NOT NULL AND length(trim(rv.feedback))>25 THEN 1 ELSE 0 END)::int AS le3_text_gt25,
           SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 AND rv.status='resolved' THEN 1 ELSE 0 END)::int AS le3_resolved
    FROM restaurants r LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    WHERE NOT r.is_owner AND NOT r.is_regional AND r.slug <> 'el-braserio'
  `);
  const row = g.rows[0];
  console.log('\n=== 12 GROUP LOCATIONS ONLY (final board numbers) ===');
  console.table([row]);

  // Reconciliation assertions
  const ok1 = row.captured === row.routed + row.private;
  const ok2 = row.private === row.priv_le3 + row.priv_4 + row.priv_5;
  console.log('\nRECONCILE captured = routed + private :', ok1, `(${row.captured} = ${row.routed} + ${row.private})`);
  console.log('RECONCILE private = le3 + 4star + 5star :', ok2, `(${row.private} = ${row.priv_le3} + ${row.priv_4} + ${row.priv_5})`);
  console.log('Routing rate:', ((row.routed/row.captured)*100).toFixed(2)+'%', '| Private rate:', ((row.private/row.captured)*100).toFixed(2)+'%');

  // Distinct rating values present (catch any rating=0 or null surprises)
  const ratings = await pool.query(`
    SELECT rv.rating, COUNT(*)::int n FROM reviews rv JOIN restaurants r ON r.id=rv.restaurant_id
    WHERE NOT r.is_owner AND NOT r.is_regional AND r.slug<>'el-braserio'
    GROUP BY rv.rating ORDER BY rv.rating`);
  console.log('\n=== RATING DISTRIBUTION (12 locations) ===');
  console.table(ratings.rows);

  await pool.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});

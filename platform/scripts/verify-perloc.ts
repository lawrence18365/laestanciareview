import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = await pool.query(`
    WITH snap AS (SELECT now() ts)
    SELECT r.name, r.google_rating AS star, r.google_review_count AS profile,
      COUNT(rv.id)::int captured,
      SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int routed,
      SUM(CASE WHEN NOT rv.sent_to_google THEN 1 ELSE 0 END)::int priv,
      SUM(CASE WHEN NOT rv.sent_to_google AND rv.rating<=3 THEN 1 ELSE 0 END)::int le3,
      ROUND(100.0*SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)/NULLIF(COUNT(rv.id),0),1) AS route_pct
    FROM restaurants r LEFT JOIN reviews rv ON rv.restaurant_id=r.id
    WHERE NOT r.is_owner AND NOT r.is_regional AND r.slug<>'el-braserio'
    GROUP BY r.id ORDER BY captured DESC`);
  console.log('ATOMIC PER-LOCATION SNAPSHOT (12 group locations)');
  console.table(q.rows);
  const t = q.rows.reduce((a,r)=>({captured:a.captured+r.captured,routed:a.routed+r.routed,priv:a.priv+r.priv,le3:a.le3+r.le3}),{captured:0,routed:0,priv:0,le3:0});
  console.log('SUM CHECK:', t, '| route%', (100*t.routed/t.captured).toFixed(2));
  await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1);});

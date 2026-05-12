import { config } from 'dotenv';
const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const pool = new Pool({ connectionString: url });

  try {
    const total = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM prospect_views`,
    );
    const last30 = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM prospect_views WHERE last_view_at > now() - interval '30 days'`,
    );
    const last7 = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM prospect_views WHERE last_view_at > now() - interval '7 days'`,
    );
    const totalViews = await pool.query<{ sum: number }>(
      `SELECT COALESCE(SUM(view_count), 0)::int AS sum FROM prospect_views`,
    );
    const top10 = await pool.query(
      `SELECT restaurant_name AS name, view_count AS views, rating, last_view_at AS last_view
       FROM prospect_views ORDER BY view_count DESC LIMIT 10`,
    );

    console.log(JSON.stringify({
      env_file: envFile,
      unique_placeids_total: total.rows[0]?.count ?? 0,
      unique_placeids_last_30d: last30.rows[0]?.count ?? 0,
      unique_placeids_last_7d: last7.rows[0]?.count ?? 0,
      total_pageviews_alltime: totalViews.rows[0]?.sum ?? 0,
      top10: top10.rows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

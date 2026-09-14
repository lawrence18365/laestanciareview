/**
 * Per-unit tap funnel audit (Juan Carlos question, 2026-09-14).
 *
 * Answers: card tap -> rating screen -> rating submitted -> Google click,
 * per location, plus the duplicate-tap and rating-correlation checks.
 *
 * Window notes baked into the output:
 *   review_page_open exists only from 2026-08-21 (Product Analytics V1, 01edea5)
 *   sent_to_google means "clicked Google" only from 2026-07-08 (GOOGLE_CLICK_SINCE)
 */
import { config } from 'dotenv';
config({ path: process.env.ENV_FILE ?? '.env.local' });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

const OPEN_SINCE = '2026-08-21';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const pool = new Pool({ connectionString: url });
  const q = async (label: string, sql: string) => {
    const r = await pool.query(sql);
    console.log(`\n===== ${label} =====`);
    if (r.rows.length === 0) { console.log('(no rows)'); return r.rows; }
    console.table(r.rows);
    return r.rows;
  };

  try {
    await q('0. WINDOW SANITY', `
      SELECT
        (SELECT min(created_at)::date FROM product_events WHERE event_name='review_page_open') AS first_page_open,
        (SELECT count(*)::int FROM product_events WHERE event_name='review_page_open') AS page_opens_all_time,
        (SELECT count(*)::int FROM reviews) AS reviews_all_time,
        now()::date AS today`);

    // Main funnel, clean window where all four signals exist.
    await q(`1. FUNNEL per unit  (${OPEN_SINCE} -> now, page-open era)`, `
      WITH r AS (SELECT id, name, region FROM restaurants
                 WHERE is_owner=false AND is_regional=false),
      opens AS (
        SELECT restaurant_id,
               count(*)::int AS page_opens,
               count(*) FILTER (WHERE (properties->>'has_card')::boolean IS TRUE)::int AS with_card,
               count(*) FILTER (WHERE (properties->>'has_card')::boolean IS NOT TRUE)::int AS no_card,
               count(DISTINCT session_id)::int AS distinct_sessions
        FROM product_events
        WHERE event_name='review_page_open' AND created_at >= '${OPEN_SINCE}'
        GROUP BY 1),
      rev AS (
        SELECT restaurant_id,
               count(*)::int AS submitted,
               count(*) FILTER (WHERE sent_to_google)::int AS google_click,
               count(*) FILTER (WHERE feedback IS NOT NULL)::int AS private_feedback
        FROM reviews WHERE created_at >= '${OPEN_SINCE}' GROUP BY 1)
      SELECT r.name, r.region,
             COALESCE(o.page_opens,0) AS screen_loads,
             COALESCE(o.distinct_sessions,0) AS distinct_sessions,
             COALESCE(o.with_card,0) AS with_card,
             COALESCE(o.no_card,0) AS no_card,
             COALESCE(v.submitted,0) AS rating_submitted,
             CASE WHEN COALESCE(o.page_opens,0)>0
                  THEN round(100.0*COALESCE(v.submitted,0)/o.page_opens,1) END AS pct_load_to_rating,
             COALESCE(v.google_click,0) AS google_click,
             CASE WHEN COALESCE(v.submitted,0)>0
                  THEN round(100.0*COALESCE(v.google_click,0)/v.submitted,1) END AS pct_rating_to_google,
             COALESCE(v.private_feedback,0) AS private_feedback
      FROM r LEFT JOIN opens o ON o.restaurant_id=r.id
             LEFT JOIN rev v ON v.restaurant_id=r.id
      ORDER BY screen_loads DESC NULLS LAST`);

    await q('2. THE QUERETARO CHECK — same query, two labels (last 30d)', `
      SELECT name,
             (SELECT count(*)::int FROM reviews WHERE restaurant_id=r.id
                AND created_at >= now()-interval '30 days') AS escaneos_as_coded,
             (SELECT count(*)::int FROM reviews WHERE restaurant_id=r.id
                AND created_at >= now()-interval '30 days') AS resenas_totales_as_coded
      FROM restaurants r WHERE name ILIKE '%quer%' OR slug ILIKE '%quer%'`);

    await q('3. DROP-OFF vs RATING GIVEN (his hypothesis) — group-wide, 30d', `
      SELECT rating,
             count(*)::int AS submitted,
             count(*) FILTER (WHERE sent_to_google)::int AS clicked_google,
             round(100.0*count(*) FILTER (WHERE sent_to_google)/count(*),1) AS pct_clicked,
             count(*) FILTER (WHERE feedback IS NOT NULL)::int AS wrote_private_feedback
      FROM reviews WHERE created_at >= now()-interval '30 days'
      GROUP BY rating ORDER BY rating`);

    await q('4. DUPLICATE TAPS — same device, same unit, within 24h (30d)', `
      WITH d AS (
        SELECT restaurant_id, device_hash, date_trunc('day', created_at) AS day, count(*)::int AS n
        FROM reviews
        WHERE created_at >= now()-interval '30 days' AND device_hash IS NOT NULL
        GROUP BY 1,2,3 HAVING count(*) > 1)
      SELECT rr.name,
             count(*)::int AS device_days_with_repeat,
             sum(d.n)::int AS rows_involved,
             sum(d.n - 1)::int AS surplus_rows_beyond_first
      FROM d JOIN restaurants rr ON rr.id=d.restaurant_id
      GROUP BY 1 ORDER BY surplus_rows_beyond_first DESC`);

    await q('5. NULL DEVICE HASH — rows that cannot be dedup-checked at all (30d)', `
      SELECT count(*)::int AS total_30d,
             count(*) FILTER (WHERE device_hash IS NULL)::int AS null_device_hash,
             round(100.0*count(*) FILTER (WHERE device_hash IS NULL)/count(*),1) AS pct_null
      FROM reviews WHERE created_at >= now()-interval '30 days'`);

    await q('6. PAGE OPENS per session — repeat loads inside one session (page-open era)', `
      WITH s AS (
        SELECT session_id, count(*)::int AS loads FROM product_events
        WHERE event_name='review_page_open' AND created_at >= '${OPEN_SINCE}'
          AND session_id IS NOT NULL GROUP BY 1)
      SELECT count(*)::int AS sessions,
             sum(loads)::int AS total_loads,
             count(*) FILTER (WHERE loads=1)::int AS single_load_sessions,
             count(*) FILTER (WHERE loads>1)::int AS multi_load_sessions,
             sum(loads-1)::int AS surplus_loads
      FROM s`);

    await q('7. SESSION_ID COVERAGE on guest page opens', `
      SELECT count(*)::int AS opens,
             count(session_id)::int AS with_session_id,
             count(DISTINCT session_id)::int AS distinct_sessions
      FROM product_events
      WHERE event_name='review_page_open' AND created_at >= '${OPEN_SINCE}'`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

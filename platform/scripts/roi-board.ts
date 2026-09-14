/**
 * ROI proof board — attribution-safe only.
 *
 *   npm run roi:board [-- --days 30]
 *
 * Section A  directly proven from our own data, one event each, full history.
 * Section B  strongly attributable, with the date each signal became valid.
 * Section C  CONTEXT ONLY. Google's own movement. Never labelled as caused by us.
 * Section D  is deliberately absent: unmeasurable things are not ROI claims.
 */
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { INSTRUMENTATION_T0, GOOGLE_CLICK_SINCE, pct, confidence } from './funnel-report';
neonConfig.webSocketConstructor = ws;

const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 30;

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(3); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      WITH base AS (SELECT id, slug, name FROM restaurants WHERE is_owner=false AND is_regional=false),
      rv AS (
        SELECT restaurant_id,
          count(*)::int AS ratings,
          count(DISTINCT staff_id) FILTER (WHERE staff_id IS NOT NULL)::int AS active_waiters,
          count(DISTINCT (created_at AT TIME ZONE 'America/Mexico_City')::date)::int AS active_days,
          count(*) FILTER (WHERE feedback IS NOT NULL)::int AS private_feedback,
          count(*) FILTER (WHERE sent_to_google AND created_at >= $2)::int AS google_clicks,
          count(*) FILTER (WHERE feedback IS NOT NULL AND resolved_at IS NOT NULL)::int AS resolved,
          count(*) FILTER (WHERE feedback IS NOT NULL AND resolved_at IS NOT NULL
                             AND resolved_at - created_at < interval '24 hours')::int AS resolved_fast,
          round(avg(rating)::numeric,2) AS avg_rating
        FROM reviews WHERE created_at >= now() - ($1 || ' days')::interval GROUP BY 1),
      mgr AS (
        SELECT restaurant_id,
          count(DISTINCT (created_at AT TIME ZONE 'America/Mexico_City')::date)::int AS mgr_active_days
        FROM product_events
        WHERE role IN ('gm','owner','regional') AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY 1),
      guard AS (
        SELECT restaurant_id,
          count(*) FILTER (WHERE event_name='review_screen_shown')::int AS pantalla,
          count(*) FILTER (WHERE event_name='review_blocked_local_guard')::int AS bloqueados
        FROM product_events WHERE created_at >= $3 GROUP BY 1)
      SELECT b.slug, b.name,
             COALESCE(v.ratings,0) AS ratings, COALESCE(v.active_waiters,0) AS active_waiters,
             COALESCE(v.active_days,0) AS active_days, COALESCE(v.private_feedback,0) AS private_feedback,
             COALESCE(v.google_clicks,0) AS google_clicks, COALESCE(v.resolved,0) AS resolved,
             COALESCE(v.resolved_fast,0) AS resolved_fast, v.avg_rating,
             COALESCE(m.mgr_active_days,0) AS mgr_active_days,
             COALESCE(g.pantalla,0) AS pantalla, COALESCE(g.bloqueados,0) AS bloqueados
        FROM base b LEFT JOIN rv v ON v.restaurant_id=b.id
                    LEFT JOIN mgr m ON m.restaurant_id=b.id
                    LEFT JOIN guard g ON g.restaurant_id=b.id
       ORDER BY COALESCE(v.ratings,0) DESC`,
      [String(DAYS), GOOGLE_CLICK_SINCE, INSTRUMENTATION_T0]);

    const { rows: byRating } = await pool.query(`
      SELECT rating::int AS rating, count(*)::int AS n,
             count(*) FILTER (WHERE sent_to_google AND created_at >= $2)::int AS clicks
        FROM reviews WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY 1 ORDER BY 1`, [String(DAYS), GOOGLE_CLICK_SINCE]);

    console.log('='.repeat(96));
    console.log(`ROI PROOF BOARD — last ${DAYS} days — attribution-safe metrics only`);
    console.log('='.repeat(96));

    console.log('\n--- A. DIRECTLY PROVEN (our own data, full history) ---');
    console.log('unit'.padEnd(24) + ['Calif', 'Meseros', 'Cal/mes.', 'Cal/día', 'Privado', 'SLA<24h', 'GM días']
      .map((h) => h.padStart(9)).join('') + '  confianza');
    console.log('-'.repeat(96));
    for (const r of rows) {
      const perWaiter = r.active_waiters > 0 ? (r.ratings / r.active_waiters).toFixed(1) : '—';
      const perDay = r.active_days > 0 ? (r.ratings / r.active_days).toFixed(1) : '—';
      console.log(String(r.name).slice(0, 23).padEnd(24) +
        String(r.ratings).padStart(9) + String(r.active_waiters).padStart(9) +
        perWaiter.padStart(9) + perDay.padStart(9) +
        String(r.private_feedback).padStart(9) +
        pct(r.resolved_fast, r.resolved).padStart(9) +
        String(r.mgr_active_days).padStart(9) + '  ' + confidence(r.ratings));
    }

    console.log('\n--- B. STRONGLY ATTRIBUTABLE (valid from the stated date only) ---');
    console.log(`Google CTA clicks valid from ${GOOGLE_CLICK_SINCE}. Guard/repeat from ${INSTRUMENTATION_T0}.`);
    console.log('unit'.padEnd(24) + ['Clics', 'Clic/Cal', 'Pantalla', 'Bloq', 'Bloq %'].map((h) => h.padStart(11)).join(''));
    console.log('-'.repeat(96));
    for (const r of rows) {
      const loads = r.pantalla + r.bloqueados;
      console.log(String(r.name).slice(0, 23).padEnd(24) +
        String(r.google_clicks).padStart(11) + pct(r.google_clicks, r.ratings).padStart(11) +
        String(r.pantalla).padStart(11) + String(r.bloqueados).padStart(11) +
        pct(r.bloqueados, loads).padStart(11));
    }

    console.log('\n--- B. RATING -> GOOGLE CTA (post-submission only) ---');
    console.log('Says nothing about guests who left before submitting a rating: they have no rating.');
    for (const r of byRating as Array<{ rating: number; n: number; clicks: number }>) {
      console.log(`  ${r.rating}★  calificaciones ${String(r.n).padStart(5)}   clics ${String(r.clicks).padStart(5)}   ${pct(r.clicks, r.n)}`);
    }

    console.log('\n--- C. CONTEXT ONLY — NOT A RATETAP RESULT ---');
    console.log('Google review-count and rating movement are moved by every source, including');
    console.log('organic visitors and Google review removals. Nothing joins a CTA click to a');
    console.log('published review. These numbers must never be presented as caused by RateTap.');
    console.log('They are deliberately not printed on this board; read them from the dashboard');
    console.log('context line, which states the two observations separately.');

    console.log('\n--- D. NOT MEASURABLE — never an ROI claim ---');
    console.log('  Google reviews caused by RateTap · recovered unhappy guests · complaints');
    console.log('  prevented from being posted publicly · incremental reviews vs counterfactual.');
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

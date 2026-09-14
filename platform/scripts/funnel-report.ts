/**
 * Per-unit guest funnel report.
 *
 *   npx tsx scripts/funnel-report.ts [--start ISO] [--end ISO] [--unit slug] [--json]
 *
 * Time zero is the instrumentation go-live (INSTRUMENTATION_T0). Before that
 * timestamp only two of the funnel's stages existed, so a rate spanning it is
 * meaningless. The report refuses to compute post-instrumentation conversion
 * for any window starting earlier, rather than quietly producing a blended
 * number.
 *
 * METRIC DEFINITIONS (one event each, no label may imply a different event):
 *   Calificaciones     submitted star ratings           rows in `reviews`
 *   Aperturas          guest page loads                 product_events review_page_open
 *   Pantalla mostrada  rating UI actually shown         product_events review_screen_shown
 *   Bloqueados         rating UI suppressed by guard    product_events review_blocked_local_guard
 *   Google             Google CTA clicks                reviews.sent_to_google = true
 */
import { config } from 'dotenv';
config({ path: process.env.ENV_FILE ?? '.env.local' });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

/**
 * Instrumentation go-live. Set to the start of the minute containing the first
 * observed review_screen_shown (19:26:15.549Z) rather than that instant itself,
 * so a load and the client event it produced stay inside the same window — a
 * page_open fires server-side seconds before the browser hydrates and reports.
 * Pinning T0 to the client event alone orphaned its own page_open and produced a
 * negative telemetry gap. The instrumented bundle was confirmed serving in
 * production several minutes earlier, so this boundary contains no old-bundle loads.
 */
export const INSTRUMENTATION_T0 = '2026-09-14T19:26:00.000Z';
/** sent_to_google means "guest clicked Google" only from this date (ee2c182). */
export const GOOGLE_CLICK_SINCE = '2026-07-08T00:00:00Z';
/** review_page_open first existed at this date (01edea5). */
export const PAGE_OPEN_SINCE = '2026-08-21T20:14:57.588Z';

/** Below this denominator a percentage is noise; we print the count, not a rate. */
const MIN_SAMPLE = 30;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const asJson = process.argv.includes('--json');

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  if (den < MIN_SAMPLE) return `n=${den}*`;
  return `${((100 * num) / den).toFixed(1)}%`;
}

type Row = {
  slug: string; name: string; region: string | null;
  aperturas: number; pantalla: number; bloqueados: number;
  calificaciones: number; google: number; sessions: number;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing — is .env.local present?');

  const start = arg('start') ?? INSTRUMENTATION_T0;
  const end = arg('end') ?? new Date().toISOString();
  const unit = arg('unit');
  const startsBeforeT0 = new Date(start) < new Date(INSTRUMENTATION_T0);

  const pool = new Pool({ connectionString: url });
  try {
    const unitFilter = unit ? `AND r.slug = '${unit.replace(/'/g, "''")}'` : '';

    const { rows } = await pool.query<Row>(`
      WITH base AS (
        SELECT id, slug, name, region FROM restaurants
         WHERE is_owner = false AND is_regional = false ${unitFilter}
      ),
      ev AS (
        SELECT restaurant_id,
          count(*) FILTER (WHERE event_name='review_page_open')::int             AS aperturas,
          count(*) FILTER (WHERE event_name='review_screen_shown')::int          AS pantalla,
          count(*) FILTER (WHERE event_name='review_blocked_local_guard')::int   AS bloqueados,
          count(DISTINCT session_id) FILTER (
            WHERE event_name IN ('review_screen_shown','review_blocked_local_guard')
          )::int AS sessions
        FROM product_events
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1
      ),
      rv AS (
        SELECT restaurant_id,
          count(*)::int AS calificaciones,
          count(*) FILTER (WHERE sent_to_google AND created_at >= $3)::int AS google
        FROM reviews
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1
      )
      SELECT b.slug, b.name, b.region,
             COALESCE(e.aperturas,0) AS aperturas,
             COALESCE(e.pantalla,0) AS pantalla,
             COALESCE(e.bloqueados,0) AS bloqueados,
             COALESCE(e.sessions,0) AS sessions,
             COALESCE(v.calificaciones,0) AS calificaciones,
             COALESCE(v.google,0) AS google
        FROM base b
        LEFT JOIN ev e ON e.restaurant_id = b.id
        LEFT JOIN rv v ON v.restaurant_id = b.id
       ORDER BY COALESCE(e.aperturas,0) DESC, b.slug
    `, [start, end, GOOGLE_CLICK_SINCE]);

    const { rows: ratingRows } = await pool.query(`
      SELECT rating::int AS rating,
             count(*)::int AS submitted,
             count(*) FILTER (WHERE sent_to_google AND created_at >= $3)::int AS google
        FROM reviews
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY 1
    `, [start, end, GOOGLE_CLICK_SINCE]);

    if (asJson) {
      console.log(JSON.stringify({
        window: { start, end, t0: INSTRUMENTATION_T0, startsBeforeT0 },
        units: rows, ratings: ratingRows,
      }, null, 2));
      return;
    }

    const tot = rows.reduce((a, r) => ({
      aperturas: a.aperturas + r.aperturas, pantalla: a.pantalla + r.pantalla,
      bloqueados: a.bloqueados + r.bloqueados, sessions: a.sessions + r.sessions,
      calificaciones: a.calificaciones + r.calificaciones, google: a.google + r.google,
    }), { aperturas: 0, pantalla: 0, bloqueados: 0, sessions: 0, calificaciones: 0, google: 0 });

    console.log('='.repeat(78));
    console.log('FUNNEL REPORT — per unit');
    console.log('='.repeat(78));
    console.log(`window        : ${start}  ->  ${end}`);
    console.log(`time zero     : ${INSTRUMENTATION_T0}  (instrumentation go-live)`);
    if (unit) console.log(`unit filter   : ${unit}`);
    console.log(`* a rate shown as "n=NN*" means the denominator is under ${MIN_SAMPLE}: too small to read as a rate.`);

    if (startsBeforeT0) {
      console.log('');
      console.log('!! WINDOW STARTS BEFORE TIME ZERO.');
      console.log('!! Pantalla/Bloqueados/Sessions did not exist for part of this window, so');
      console.log('!! every conversion involving them is INVALID here. Only Aperturas,');
      console.log('!! Calificaciones and Google are meaningful. Re-run without --start,');
      console.log('!! or with --start at or after time zero, for funnel rates.');
    }

    console.log('');
    console.log('--- C. NEW POST-INSTRUMENTATION METRICS (trustworthy only from time zero) ---');
    console.log('Definitions: Aperturas=page loads · Pantalla=rating UI shown · Bloqueados=UI');
    console.log('suppressed by repeat-visit guard · Calificaciones=submitted star ratings ·');
    console.log('Google=Google CTA clicks · Sesiones=distinct per-tab session ids (NOT guests).');
    console.log('');
    const head = ['unit', 'Apert', 'Pant', 'Bloq', 'Calif', 'Google', 'Sesion'];
    console.log(head[0].padEnd(24) + head.slice(1).map((h) => h.padStart(8)).join(''));
    console.log('-'.repeat(78));
    for (const r of rows) {
      console.log(
        r.name.slice(0, 23).padEnd(24) +
        String(r.aperturas).padStart(8) + String(r.pantalla).padStart(8) +
        String(r.bloqueados).padStart(8) + String(r.calificaciones).padStart(8) +
        String(r.google).padStart(8) + String(r.sessions).padStart(8),
      );
    }
    console.log('-'.repeat(78));
    console.log(
      'GROUP'.padEnd(24) + String(tot.aperturas).padStart(8) + String(tot.pantalla).padStart(8) +
      String(tot.bloqueados).padStart(8) + String(tot.calificaciones).padStart(8) +
      String(tot.google).padStart(8) + String(tot.sessions).padStart(8),
    );

    console.log('');
    console.log('--- CONVERSION BETWEEN STAGES ---');
    const ch = ['unit', 'Pant/Ap', 'Cal/Pant', 'Goog/Cal', 'Bloq rate', 'Repeat load'];
    console.log(ch[0].padEnd(24) + ch.slice(1).map((h) => h.padStart(12)).join(''));
    console.log('-'.repeat(78));
    const line = (label: string, r: Omit<Row, 'slug' | 'name' | 'region'>) => {
      const clientLoads = r.pantalla + r.bloqueados;
      console.log(
        label.slice(0, 23).padEnd(24) +
        pct(r.pantalla, r.aperturas).padStart(12) +
        pct(r.calificaciones, r.pantalla).padStart(12) +
        pct(r.google, r.calificaciones).padStart(12) +
        pct(r.bloqueados, clientLoads).padStart(12) +
        pct(clientLoads - r.sessions, clientLoads).padStart(12),
      );
    };
    for (const r of rows) line(r.name, r);
    console.log('-'.repeat(78));
    line('GROUP', tot);
    console.log('');
    console.log('Bloq rate   = Bloqueados / (Pantalla + Bloqueados) — share of loads the guard turned away.');
    console.log('Repeat load = 1 - Sesiones / (Pantalla + Bloqueados) — share of loads that were not a new tab.');
    const gap = tot.aperturas - (tot.pantalla + tot.bloqueados);
    console.log(`Telemetry gap: Aperturas - (Pantalla+Bloqueados) = ${gap}. Server-side loads with no`);
    console.log('client event (JS blocked, beacon dropped, or bounce before hydration). Not a funnel stage.');

    console.log('');
    console.log('--- RATING CORRELATION: downstream Google CTA rate by submitted rating ---');
    console.log('Measures ONLY what happened AFTER a rating was submitted. Abandonment');
    console.log('BEFORE submission has no rating attached and is not represented here;');
    console.log('nothing in this table can explain pre-submission drop-off.');
    console.log('');
    console.log('rating'.padEnd(10) + 'submitted'.padStart(12) + 'Google'.padStart(10) + 'CTA rate'.padStart(12));
    console.log('-'.repeat(44));
    for (const r of ratingRows as Array<{ rating: number; submitted: number; google: number }>) {
      console.log(
        `${r.rating}*`.padEnd(10) + String(r.submitted).padStart(12) +
        String(r.google).padStart(10) + pct(r.google, r.submitted).padStart(12),
      );
    }
    if (ratingRows.length === 0) console.log('(no submitted ratings in this window)');

    console.log('');
    console.log('--- A. HISTORICAL METRICS THAT REMAIN TRUSTWORTHY ---');
    console.log(`  Calificaciones (submitted ratings)  — full history, rows in \`reviews\`.`);
    console.log(`  Google CTA clicks                   — from ${GOOGLE_CLICK_SINCE} only;`);
    console.log('    before that date sent_to_google carried a different meaning (ee2c182).');
    console.log(`  Aperturas (raw page loads)          — from ${PAGE_OPEN_SINCE} only.`);
    console.log('');
    console.log('--- B. HISTORICAL METRICS THAT CANNOT BE RECONSTRUCTED ---');
    console.log('  Pantalla mostrada, Bloqueados, Sesiones, repeat-load rate, guard-block');
    console.log('  rate: no event existed before time zero. These are NOT recoverable for any');
    console.log('  earlier period, at any unit, by any query. Pre-time-zero load->rating rates');
    console.log('  (see docs/funnel-audit-2026-09-14.md) are a DIFFERENT measurement and must');
    console.log('  never be compared with the conversions above.');
    console.log('');
    console.log('No causal claim is made by this report. It describes counts and rates only.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

/**
 * Per-unit guest funnel report — production measurement infrastructure.
 *
 *   npm run funnel:report                                  post-instrumentation funnel
 *   npm run funnel:report -- --unit estancia-queretaro      one unit
 *   npm run funnel:report -- --start ISO --end ISO          explicit window
 *   npm run funnel:report -- --json                         machine-readable
 *   npm run funnel:report -- --historical                   30-day trustworthy-only table
 *   npm run funnel:report -- --help
 *
 * Time zero is the instrumentation go-live (INSTRUMENTATION_T0). Before that
 * timestamp only two funnel stages existed, so a rate spanning it is
 * meaningless. The report refuses to present post-instrumentation conversion for
 * a window starting earlier rather than quietly producing a blended number.
 *
 * METRIC DEFINITIONS — one event each, no label may imply a different event:
 *   Calificaciones     submitted star ratings        rows in `reviews`
 *   Aperturas          guest page loads              product_events review_page_open
 *   Pantalla mostrada  rating UI actually shown      product_events review_screen_shown
 *   Bloqueados         rating UI suppressed by guard product_events review_blocked_local_guard
 *   Google             Google CTA clicks             reviews.sent_to_google = true
 *   Sesiones únicas    distinct per-tab session ids  session_id on the two client events
 */
import { config } from 'dotenv';
// Quiet before loading: dotenv's banner goes to stdout and would corrupt --json.
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

/**
 * Instrumentation go-live: start of the minute containing the first observed
 * review_screen_shown (19:26:15.549Z). Pinned to the minute, not the instant, so
 * a load and the client event it produced stay in the same window — page_open
 * fires server-side seconds before the browser hydrates and reports. The
 * instrumented bundle was confirmed serving minutes earlier, so this boundary
 * contains no old-bundle loads.
 */
export const INSTRUMENTATION_T0 = '2026-09-14T19:26:00.000Z';
/** sent_to_google means "guest clicked Google" only from this date (ee2c182). */
export const GOOGLE_CLICK_SINCE = '2026-07-08T00:00:00Z';
/** review_page_open first existed at this timestamp (01edea5). */
export const PAGE_OPEN_SINCE = '2026-08-21T20:14:57.588Z';
/** Below this denominator a percentage is noise; print the count instead. */
export const MIN_SAMPLE = 30;

export interface ParsedArgs {
  start: string;
  end: string;
  unit?: string;
  json: boolean;
  historical: boolean;
  help: boolean;
}

export class ArgError extends Error {}

/** Pure, unit-testable argument parsing + window validation. */
export function parseArgs(argv: string[], now = new Date()): ParsedArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new ArgError(`--${name} requires a value`);
    return v;
  };

  const help = argv.includes('--help') || argv.includes('-h');
  const json = argv.includes('--json');
  const historical = argv.includes('--historical');

  const rawStart = get('start');
  const rawEnd = get('end');
  const unit = get('unit');

  if (unit !== undefined && !/^[a-z0-9-]{1,100}$/.test(unit)) {
    throw new ArgError(
      `--unit "${unit}" is not a valid slug (lowercase letters, digits and hyphens only)`,
    );
  }

  const defaultStart = historical
    ? new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
    : INSTRUMENTATION_T0;

  const start = rawStart ?? defaultStart;
  const end = rawEnd ?? now.toISOString();

  for (const [label, value] of [['--start', start], ['--end', end]] as const) {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new ArgError(`${label} "${value}" is not a valid ISO-8601 timestamp`);
    }
  }
  if (new Date(end) <= new Date(start)) {
    throw new ArgError(`--end (${end}) must be after --start (${start})`);
  }

  return { start, end, unit, json, historical, help };
}

/** True when the window reaches back before instrumentation existed. */
export function startsBeforeT0(start: string): boolean {
  return new Date(start) < new Date(INSTRUMENTATION_T0);
}

export function pct(num: number, den: number): string {
  if (den === 0) return '—';
  if (den < MIN_SAMPLE) return `n=${den}*`;
  return `${((100 * num) / den).toFixed(1)}%`;
}

/** Sample-size marker shown per unit so no rate is read without its denominator. */
export function confidence(n: number): string {
  if (n === 0) return 'sin datos';
  if (n < MIN_SAMPLE) return 'muy bajo';
  if (n < 100) return 'bajo';
  if (n < 500) return 'medio';
  return 'alto';
}

export const HELP = `funnel-report — per-unit guest funnel

  --start ISO     window start (default: instrumentation time zero)
  --end ISO       window end   (default: now)
  --unit SLUG     restrict to one restaurant slug
  --json          machine-readable output
  --historical    30-day table of historically trustworthy metrics only
  --help          this message

time zero: ${INSTRUMENTATION_T0}`;

type Row = {
  slug: string; name: string; region: string | null;
  aperturas: number; pantalla: number; bloqueados: number;
  calificaciones: number; google: number; sessions: number;
};

const FUNNEL_SQL = `
  WITH base AS (
    SELECT r.id, r.slug, r.name, r.region FROM restaurants r
     WHERE r.is_owner = false AND r.is_regional = false
       AND ($4::text IS NULL OR r.slug = $4)
  ),
  ev AS (
    SELECT restaurant_id,
      count(*) FILTER (WHERE event_name='review_page_open')::int           AS aperturas,
      count(*) FILTER (WHERE event_name='review_screen_shown')::int        AS pantalla,
      count(*) FILTER (WHERE event_name='review_blocked_local_guard')::int AS bloqueados,
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
   ORDER BY COALESCE(e.aperturas,0) DESC, b.slug`;

const RATING_SQL = `
  SELECT v.rating::int AS rating,
         count(*)::int AS submitted,
         count(*) FILTER (WHERE v.sent_to_google AND v.created_at >= $3)::int AS google
    FROM reviews v
    JOIN restaurants r ON r.id = v.restaurant_id
   WHERE v.created_at >= $1 AND v.created_at < $2
     AND r.is_owner = false AND r.is_regional = false
     AND ($4::text IS NULL OR r.slug = $4)
   GROUP BY 1 ORDER BY 1`;

/** Historical mode: only metrics whose source event covers the whole window. */
const HISTORICAL_SQL = `
  WITH base AS (
    SELECT r.id, r.slug, r.name FROM restaurants r
     WHERE r.is_owner = false AND r.is_regional = false
       AND ($4::text IS NULL OR r.slug = $4)
  ),
  rv AS (
    SELECT restaurant_id,
      count(*)::int AS calificaciones,
      count(*) FILTER (WHERE sent_to_google AND created_at >= $3)::int AS google,
      round(avg(rating)::numeric, 2) AS avg_rating
    FROM reviews WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
  ),
  ap AS (
    SELECT restaurant_id, count(*)::int AS aperturas
    FROM product_events
    WHERE event_name='review_page_open'
      AND created_at >= GREATEST($1::timestamptz, $5::timestamptz) AND created_at < $2
    GROUP BY 1
  )
  SELECT b.slug, b.name,
         COALESCE(v.calificaciones,0) AS calificaciones,
         COALESCE(v.google,0) AS google,
         v.avg_rating,
         COALESCE(a.aperturas,0) AS aperturas_partial
    FROM base b
    LEFT JOIN rv v ON v.restaurant_id = b.id
    LEFT JOIN ap a ON a.restaurant_id = b.id
   ORDER BY COALESCE(v.calificaciones,0) DESC, b.slug`;

async function main() {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ArgError) {
      console.error(`error: ${e.message}\n\n${HELP}`);
      process.exit(2);
    }
    throw e;
  }
  if (args.help) { console.log(HELP); return; }

  const url = process.env.DATABASE_URL;
  if (!url) { console.error('error: DATABASE_URL missing — is .env.local present?'); process.exit(3); }

  const { start, end, unit, json, historical } = args;
  const preT0 = startsBeforeT0(start);
  const pool = new Pool({ connectionString: url });

  try {
    if (historical) {
      const { rows } = await pool.query(HISTORICAL_SQL,
        [start, end, GOOGLE_CLICK_SINCE, unit ?? null, PAGE_OPEN_SINCE]);
      if (json) {
        console.log(JSON.stringify({
          mode: 'historical', window: { start, end },
          coverage: { calificaciones: 'full', google: `from ${GOOGLE_CLICK_SINCE}`,
                      aperturas: `partial, only from ${PAGE_OPEN_SINCE}` },
          units: rows,
        }, null, 2));
        return;
      }
      console.log('='.repeat(84));
      console.log('HISTORICAL — ONLY METRICS THAT COVER THE WHOLE WINDOW');
      console.log('='.repeat(84));
      console.log(`window: ${start}  ->  ${end}`);
      console.log('Calificaciones: full history. Google: from 2026-07-08 (meaning changed at ee2c182).');
      console.log(`Aperturas: PARTIAL — event only exists from ${PAGE_OPEN_SINCE}, so its`);
      console.log('denominator differs from this window. No conversion using it is printed here.');
      console.log('Pantalla mostrada / Bloqueados / Sesiones: DID NOT EXIST. Not shown, not inferable.');
      console.log('');
      console.log('unit'.padEnd(24) + 'Calif'.padStart(8) + 'Google'.padStart(8) +
                  'Goog/Cal'.padStart(10) + 'Prom★'.padStart(8) + 'Apert(p)'.padStart(10) + '  confianza');
      console.log('-'.repeat(84));
      let tc = 0, tg = 0, ta = 0;
      for (const r of rows as Array<Record<string, number | string | null>>) {
        const c = Number(r.calificaciones), g = Number(r.google), a = Number(r.aperturas_partial);
        tc += c; tg += g; ta += a;
        console.log(
          String(r.name).slice(0, 23).padEnd(24) + String(c).padStart(8) + String(g).padStart(8) +
          pct(g, c).padStart(10) + String(r.avg_rating ?? '—').padStart(8) +
          String(a).padStart(10) + '  ' + confidence(c));
      }
      console.log('-'.repeat(84));
      console.log('GRUPO'.padEnd(24) + String(tc).padStart(8) + String(tg).padStart(8) +
                  pct(tg, tc).padStart(10) + '—'.padStart(8) + String(ta).padStart(10) + '  ' + confidence(tc));
      console.log('');
      console.log('No causal claim is made. Counts and rates only.');
      return;
    }

    const { rows } = await pool.query<Row>(FUNNEL_SQL, [start, end, GOOGLE_CLICK_SINCE, unit ?? null]);
    const { rows: ratingRows } = await pool.query(RATING_SQL, [start, end, GOOGLE_CLICK_SINCE, unit ?? null]);

    const tot = rows.reduce((a, r) => ({
      aperturas: a.aperturas + r.aperturas, pantalla: a.pantalla + r.pantalla,
      bloqueados: a.bloqueados + r.bloqueados, sessions: a.sessions + r.sessions,
      calificaciones: a.calificaciones + r.calificaciones, google: a.google + r.google,
    }), { aperturas: 0, pantalla: 0, bloqueados: 0, sessions: 0, calificaciones: 0, google: 0 });

    if (json) {
      console.log(JSON.stringify({
        mode: 'funnel', window: { start, end, t0: INSTRUMENTATION_T0, startsBeforeT0: preT0 },
        group: tot, units: rows, ratings: ratingRows,
      }, null, 2));
      return;
    }

    console.log('='.repeat(84));
    console.log('FUNNEL REPORT — per unit');
    console.log('='.repeat(84));
    console.log(`window        : ${start}  ->  ${end}`);
    console.log(`time zero     : ${INSTRUMENTATION_T0}  (instrumentation go-live)`);
    if (unit) console.log(`unit filter   : ${unit}`);
    if (rows.length === 0) console.log(`\n(no units matched${unit ? ` slug "${unit}"` : ''})`);
    console.log(`* "n=NN*" means the denominator is under ${MIN_SAMPLE}: too small to read as a rate.`);

    if (preT0) {
      console.log('');
      console.log('!! WINDOW STARTS BEFORE TIME ZERO.');
      console.log('!! Pantalla/Bloqueados/Sesiones did not exist for part of this window, so');
      console.log('!! every conversion involving them is INVALID here. Only Aperturas,');
      console.log('!! Calificaciones and Google are meaningful. Use --historical for a');
      console.log('!! trustworthy-only view, or --start at or after time zero for funnel rates.');
    }

    console.log('');
    console.log('--- RAW COUNTS (post-instrumentation events) ---');
    console.log('unit'.padEnd(24) + ['Apert', 'Sesion', 'Pant', 'Bloq', 'Calif', 'Google']
      .map((h) => h.padStart(8)).join(''));
    console.log('-'.repeat(84));
    for (const r of rows) {
      console.log(r.name.slice(0, 23).padEnd(24) +
        String(r.aperturas).padStart(8) + String(r.sessions).padStart(8) +
        String(r.pantalla).padStart(8) + String(r.bloqueados).padStart(8) +
        String(r.calificaciones).padStart(8) + String(r.google).padStart(8));
    }
    console.log('-'.repeat(84));
    console.log('GRUPO'.padEnd(24) + String(tot.aperturas).padStart(8) + String(tot.sessions).padStart(8) +
      String(tot.pantalla).padStart(8) + String(tot.bloqueados).padStart(8) +
      String(tot.calificaciones).padStart(8) + String(tot.google).padStart(8));

    console.log('');
    console.log('--- CONVERSION BETWEEN STAGES ---');
    console.log('unit'.padEnd(24) + ['Ap→Pant', 'Pant→Cal', 'Cal→Goog', 'Repeat', 'Guard-blk']
      .map((h) => h.padStart(11)).join('') + '  confianza');
    console.log('-'.repeat(84));
    const line = (label: string, r: Omit<Row, 'slug' | 'name' | 'region'>) => {
      const clientLoads = r.pantalla + r.bloqueados;
      console.log(label.slice(0, 23).padEnd(24) +
        pct(r.pantalla, r.aperturas).padStart(11) +
        pct(r.calificaciones, r.pantalla).padStart(11) +
        pct(r.google, r.calificaciones).padStart(11) +
        pct(clientLoads - r.sessions, clientLoads).padStart(11) +
        pct(r.bloqueados, clientLoads).padStart(11) +
        '  ' + confidence(r.aperturas));
    };
    for (const r of rows) line(r.name, r);
    console.log('-'.repeat(84));
    line('GRUPO', tot);
    console.log('');
    console.log('Repeat    = 1 - Sesiones / (Pantalla + Bloqueados) — loads that were not a new tab.');
    console.log('Guard-blk = Bloqueados / (Pantalla + Bloqueados) — loads the repeat guard turned away.');
    const gap = tot.aperturas - (tot.pantalla + tot.bloqueados);
    console.log(`Reconciliation gap: Aperturas - (Pantalla+Bloqueados) = ${gap}. Server-side loads with`);
    console.log('no client event (JS blocked, beacon dropped, bounce before hydration). Not a funnel stage.');

    console.log('');
    console.log('--- RATING CORRELATION: Google CTA rate by submitted rating ---');
    console.log('Covers ONLY what happened AFTER a rating was submitted. Abandonment BEFORE');
    console.log('submission has no rating attached and is absent from this table; nothing here');
    console.log('can explain pre-submission drop-off.');
    console.log('');
    console.log('rating'.padEnd(10) + 'Calif'.padStart(10) + 'Google'.padStart(10) +
                'CTA'.padStart(10) + '  confianza');
    console.log('-'.repeat(52));
    for (const r of ratingRows as Array<{ rating: number; submitted: number; google: number }>) {
      console.log(`${r.rating}★`.padEnd(10) + String(r.submitted).padStart(10) +
        String(r.google).padStart(10) + pct(r.google, r.submitted).padStart(10) +
        '  ' + confidence(r.submitted));
    }
    if (ratingRows.length === 0) console.log('(no submitted ratings in this window)');

    console.log('');
    console.log('--- A. HISTORICALLY TRUSTWORTHY ---');
    console.log('  Calificaciones — full history, rows in `reviews`.');
    console.log(`  Google CTA     — from ${GOOGLE_CLICK_SINCE} only (meaning changed at ee2c182).`);
    console.log(`  Aperturas      — from ${PAGE_OPEN_SINCE} only; raw loads, no dedupe.`);
    console.log('--- B. NOT RECONSTRUCTABLE HISTORICALLY ---');
    console.log('  Pantalla mostrada, Bloqueados, Sesiones, repeat-load rate, guard-block rate:');
    console.log('  no event existed before time zero. Not recoverable for any earlier period, at');
    console.log('  any unit, by any query. Not inferred anywhere in this report.');
    console.log('');
    console.log('No causal claim is made. Counts and rates only.');
  } finally {
    await pool.end();
  }
}

/** Only run when executed as a CLI, so tests can import the pure helpers. */
const invokedDirectly = process.argv[1]?.includes('funnel-report');
if (invokedDirectly) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}

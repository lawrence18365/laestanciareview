/**
 * Internal 12-unit health board. Answers "is a location broken, stale, unused or
 * behaving strangely" before a customer tells us.
 *
 *   npm run health:board
 *
 * Reports observations only; the Anomaly column states WHAT is off, never why.
 */
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });
import { execSync } from 'node:child_process';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { INSTRUMENTATION_T0, GOOGLE_CLICK_SINCE, pct, confidence } from './funnel-report';
neonConfig.webSocketConstructor = ws;

function localHead(): string {
  try { return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}
const ageDays = (d: Date | null) => d == null ? null : (Date.now() - d.getTime()) / 86_400_000;
const fmtAge = (d: Date | null) => {
  const a = ageDays(d);
  if (a == null) return 'nunca';
  if (a < 1) return `${Math.round(a * 24)}h`;
  return `${Math.floor(a)}d`;
};

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(3); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      WITH base AS (SELECT id, slug, name FROM restaurants WHERE is_owner=false AND is_regional=false),
      ev AS (
        SELECT restaurant_id,
          max(created_at) FILTER (WHERE role IN ('gm','owner','regional')) AS last_mgr,
          max(created_at) FILTER (WHERE display_mode='standalone') AS last_standalone,
          count(*) FILTER (WHERE display_mode='standalone')::int AS standalone_events,
          count(*) FILTER (WHERE display_mode='browser')::int AS browser_events,
          count(*) FILTER (WHERE event_name='pwa_installed')::int AS installed_events,
          count(*) FILTER (WHERE event_name='pwa_install_prompt_offered')::int AS prompt_events,
          count(*) FILTER (WHERE event_name='pwa_standalone_first_open')::int AS first_standalone,
          (array_agg(properties->>'build_sha' ORDER BY created_at DESC)
             FILTER (WHERE properties->>'build_sha' IS NOT NULL))[1] AS last_build_sha,
          max(created_at) FILTER (WHERE properties->>'build_sha' IS NOT NULL) AS last_build_at
        FROM product_events GROUP BY 1),
      t0 AS (
        SELECT restaurant_id,
          count(*) FILTER (WHERE event_name='review_page_open')::int AS aperturas,
          count(*) FILTER (WHERE event_name='review_screen_shown')::int AS pantalla,
          count(*) FILTER (WHERE event_name='review_blocked_local_guard')::int AS bloqueados
        FROM product_events WHERE created_at >= $1 GROUP BY 1),
      rv AS (
        SELECT restaurant_id, max(created_at) AS last_guest,
          count(*) FILTER (WHERE created_at >= now()-interval '7 days')::int AS ratings_7d,
          count(*) FILTER (WHERE created_at >= now()-interval '7 days'
                             AND sent_to_google AND created_at >= $2)::int AS google_7d
        FROM reviews GROUP BY 1)
      SELECT b.slug, b.name, e.last_mgr, e.last_standalone, e.last_build_sha, e.last_build_at,
             COALESCE(e.standalone_events,0) AS standalone_events,
             COALESCE(e.browser_events,0) AS browser_events,
             COALESCE(e.installed_events,0) AS installed_events,
             COALESCE(e.prompt_events,0) AS prompt_events,
             COALESCE(e.first_standalone,0) AS first_standalone,
             COALESCE(t.aperturas,0) AS aperturas, COALESCE(t.pantalla,0) AS pantalla,
             COALESCE(t.bloqueados,0) AS bloqueados,
             v.last_guest, COALESCE(v.ratings_7d,0) AS ratings_7d, COALESCE(v.google_7d,0) AS google_7d
        FROM base b LEFT JOIN ev e ON e.restaurant_id=b.id
                    LEFT JOIN t0 t ON t.restaurant_id=b.id
                    LEFT JOIN rv v ON v.restaurant_id=b.id
       ORDER BY v.last_guest DESC NULLS LAST`, [INSTRUMENTATION_T0, GOOGLE_CLICK_SINCE]);

    const head = localHead();
    console.log('='.repeat(112));
    console.log('HEALTH BOARD — 12 units');
    console.log('='.repeat(112));
    console.log(`local HEAD (expected build): ${head}`);
    console.log(`funnel time zero           : ${INSTRUMENTATION_T0}`);
    console.log('PWA evidence: instalado=appinstalled seen · standalone=app-mode use only (iOS cannot');
    console.log('report the install event) · ninguna=no app-mode use observed, which is NOT proof it');
    console.log('was never installed. Anomaly states what is off, never why.\n');

    console.log('unit'.padEnd(23) + 'build'.padStart(10) + 'guest'.padStart(8) + 'mgr'.padStart(7) +
      'PWA'.padStart(12) + 'stand.'.padStart(8) + 'C7d'.padStart(6) + 'G7d'.padStart(6) +
      'Bloq%'.padStart(8) + 'recon'.padStart(11) + '  anomalía');
    console.log('-'.repeat(112));

    for (const r of rows) {
      const loads = r.pantalla + r.bloqueados;
      const gap = r.aperturas - loads;
      const recon = r.aperturas === 0 ? 'sin datos'
        : Math.abs(gap) <= Math.max(2, r.aperturas * 0.05) ? 'ok' : `gap ${gap}`;
      const pwa = r.installed_events > 0 ? 'instalado'
        : r.standalone_events > 0 ? 'standalone' : 'ninguna';

      const anomalies: string[] = [];
      const gAge = ageDays(r.last_guest), mAge = ageDays(r.last_mgr);
      if (gAge == null || gAge > 2) anomalies.push('sin invitados >48h');
      if (r.last_mgr == null) anomalies.push('SIN TELEMETRÍA DE GERENTE NUNCA');
      else if (mAge != null && mAge > 7) anomalies.push('gerente >7d');
      if (r.ratings_7d === 0) anomalies.push('0 calificaciones 7d');
      if (recon.startsWith('gap')) anomalies.push('reconciliación');
      if (r.last_build_sha && r.last_build_sha !== head) anomalies.push(`build ${r.last_build_sha}≠HEAD`);

      console.log(
        String(r.name).slice(0, 22).padEnd(23) +
        String(r.last_build_sha ?? '—').slice(0, 9).padStart(10) +
        fmtAge(r.last_guest).padStart(8) + fmtAge(r.last_mgr).padStart(7) +
        pwa.padStart(12) + fmtAge(r.last_standalone).padStart(8) +
        String(r.ratings_7d).padStart(6) + String(r.google_7d).padStart(6) +
        pct(r.bloqueados, loads).padStart(8) + recon.padStart(11) +
        '  ' + (anomalies.length ? anomalies.join('; ') : '—'));
    }

    console.log('-'.repeat(112));
    const noBuild = rows.filter((r) => !r.last_build_sha).length;
    console.log(`\nbuild_sha reported by ${rows.length - noBuild}/${rows.length} units.`);
    if (noBuild > 0) {
      console.log(`${noBuild} units have no build_sha yet: telemetry ships with this commit, so it only`);
      console.log('appears after each manager next opens the app on the new build. Absent build_sha');
      console.log('means "not seen yet", NOT "stale client".');
    }
    console.log('\nData confidence per unit follows the 7-day rating count:');
    for (const r of rows) console.log(`  ${String(r.name).slice(0,22).padEnd(23)} ${confidence(r.ratings_7d)}`);
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

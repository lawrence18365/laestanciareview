/**
 * Owner-side trial funnel for paid acquisition: which ad brought each
 * self-serve signup, and how far each trial got toward paying.
 *
 *   npm run trial:funnel                       signups since 2026-10-12 (Meta launch)
 *   npm run trial:funnel -- --since 2026-10-01
 *   npm run trial:funnel -- --slug tacos-del-centro   one restaurant's timeline
 *
 * Stages per restaurant (each a fact in the DB, nothing inferred):
 *   Google       google_place_id or google_review_url set (guests can be sent to Google)
 *   Activada     first guest rating (Primera calificación). This is the activation gate.
 *   Pago         latest Mercado Pago subscription status
 * Per-trial columns aperturas/clics count email_opened/email_clicked (welcome and
 * trial-nurture emails, via /api/email/t). Every count here skips bot rows
 * (properties.bot = 'true': link previews, crawlers, scanners); the rows stay in
 * product_events so history is comparable.
 * Informational, not gates: Con meseros (active staff rows) and QR descargado/compartido.
 * The QR count is restaurant-QR events (restaurant_qr_printed|downloaded|shared),
 * the no-printer steps (qr_fullscreen_opened, whatsapp_share_clicked),
 * card_qr_downloaded|shared, mesero_qr_generated, and review_page_open with has_card=false.
 *
 * Table columns: forma (restaurants.team_mode) and sucursales (restaurants.locations_band).
 * Both print '-' for NULL, and for every row before migration 0034. The values are read
 * through to_jsonb(r), so a missing column yields NULL instead of a query error.
 * "Por forma" and "Por sucursales" split signups, activated, and paying by those values.
 * meta is the answer to the /bienvenida goal question (google_profile.goal, written by
 * POST /api/onboarding/goal); '-' when unanswered, for every legacy row, and before 0034.
 * "Por meta" splits signups, activated, and paying the same way.
 *
 * Source is the signup's commercial lead UTM (utm_source/utm_content).
 *
 * Two extra views are printed after the raw table:
 *
 *  1. The /contacto funnel (see sections 1 of the signup-funnel spec). The
 *     first five steps are per-tab session ids from `product_events` and only
 *     exist from the day the events shipped, which is why the first event's
 *     date is printed alongside them. From "Cuenta creada" on, the steps are
 *     restaurant-level and use the same restaurant set as the table above.
 *     "Error al enviar" is printed but is NOT the denominator of the next step:
 *     a failed submit did not prevent a retry that succeeded.
 *
 *  2. With `--slug`, a single restaurant's timeline. It shows every
 *     `product_events` row for that restaurant plus every row carrying one of
 *     the session ids seen on its rows — that second half is what stitches the
 *     anonymous /contacto steps to the account, through the session_id that
 *     `signup_completed` carries. DB milestones (restaurant created, first
 *     staff, first review, latest Mercado Pago subscription) are interleaved.
 */
process.env.DOTENV_CONFIG_QUIET ??= 'true';
import { config } from 'dotenv';

config({ path: '.env.local' });

const LAUNCH = '2026-10-12';

/** `--name value`, or undefined when absent (a following `--flag` is not a value). */
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

function sinceArg(): string {
  const v = argValue('since');
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : LAUNCH;
}

function slugArg(): string | undefined {
  const v = argValue('slug');
  if (v === undefined) return undefined;
  if (!/^[a-z0-9-]{1,100}$/.test(v)) {
    console.error(`error: --slug "${v}" is not a valid slug`);
    process.exit(2);
  }
  return v;
}

/** Percentage of the previous step, or a dash when there is nothing to divide by. */
function pct(step: number, previous: number): string {
  if (previous <= 0) return '—';
  return `${((100 * step) / previous).toFixed(1)}%`;
}

function truncate(value: unknown, max: number): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type Counts = Record<string, number | string | null>;
type TrialRow = Record<string, string | number | boolean>;

function isPaying(r: TrialRow): boolean {
  return r.pago === 'authorized' || r.estado === 'active';
}

/** Signups, activated (first rating), and paying for each value of one column. */
function printSplit(rows: TrialRow[], key: 'forma' | 'sucursales' | 'meta', title: string) {
  // A row without the value (older query shape, NULL) counts as '-'.
  const valueOf = (r: TrialRow) => String(r[key] ?? '-');
  const values = [...new Set(rows.map(valueOf))].sort();
  console.log(`\n${title}:`);
  console.log(`  ${'valor'.padEnd(18)}${'signups'.padStart(9)}${'activadas'.padStart(11)}${'pagando'.padStart(9)}`);
  for (const value of values) {
    const group = rows.filter((r) => valueOf(r) === value);
    const activated = group.filter((r) => Number(r.calif) > 0).length;
    const paying = group.filter(isPaying).length;
    console.log(
      `  ${value.padEnd(18)}${String(group.length).padStart(9)}${String(activated).padStart(11)}${String(paying).padStart(9)}`,
    );
  }
}

async function main() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL!);
  const since = sinceArg();
  const slug = slugArg();

  if (slug) {
    await printTimeline(sql, slug);
    return;
  }

  const rows = (await sql`
    select r.slug,
           to_char(r.created_at at time zone 'America/Mexico_City', 'MM-DD HH24:MI') as creado,
           coalesce(cl.utm_source, '-') as fuente,
           coalesce(cl.utm_content, '-') as anuncio,
           coalesce(to_jsonb(r)->>'team_mode', '-') as forma,
           coalesce(to_jsonb(r)->>'locations_band', '-') as sucursales,
           coalesce(to_jsonb(r)->'google_profile'->>'goal', '-') as meta,
           (r.google_place_id is not null or r.google_review_url is not null) as google,
           (select count(*)::int from staff s where s.restaurant_id = r.id and s.active) as meseros,
           (select count(*)::int from reviews v where v.restaurant_id = r.id) as calif,
           (select count(*)::int from product_events e
             where e.restaurant_id = r.id and e.event_name = 'email_opened'
               and coalesce(e.properties->>'bot', '') <> 'true') as aperturas,
           (select count(*)::int from product_events e
             where e.restaurant_id = r.id and e.event_name = 'email_clicked'
               and coalesce(e.properties->>'bot', '') <> 'true') as clics,
           coalesce((select m.status from mercadopago_subscriptions m
                     where m.restaurant_id = r.id order by m.id desc limit 1), '-') as pago,
           r.subscription_status as estado
    from restaurants r
    left join pending_signups ps on ps.restaurant_id = r.id
    left join commercial_leads cl on cl.id = ps.lead_id
    where r.created_at >= ${since}::date
    order by r.created_at
  `) as Array<Record<string, string | number | boolean>>;

  console.log(`Trials since ${since}: ${rows.length}\n`);
  if (rows.length) console.table(rows);

  const n = rows.length;
  const count = (f: (r: Record<string, string | number | boolean>) => boolean) => rows.filter(f).length;
  console.log('Funnel:');
  console.log(`  Signups            ${n}`);
  console.log(`  Google conectado   ${count((r) => r.google === true)}`);
  console.log(`  Primera calificación ${count((r) => Number(r.calif) > 0)}`);
  console.log(`  Pagando            ${count(isPaying)}`);

  printSplit(rows, 'forma', 'Por forma (team_mode)');
  printSplit(rows, 'sucursales', 'Por sucursales (locations_band)');
  printSplit(rows, 'meta', 'Por meta (google_profile.goal)');

  // --- /contacto funnel, step by step -------------------------------------
  const sessionRows = (await sql`
    select
      count(distinct session_id) filter (where event_name = 'signup_page_view')::int as viewed,
      count(distinct session_id) filter (where event_name = 'signup_form_started')::int as started,
      count(distinct session_id) filter (where event_name = 'signup_place_selected')::int as place_selected,
      count(distinct session_id) filter (where event_name = 'signup_submit')::int as submitted,
      count(distinct session_id) filter (where event_name = 'signup_submit_failed')::int as submit_failed
    from product_events
    where created_at >= ${since}::date
      and coalesce(properties->>'bot', '') <> 'true'
  `) as Counts[];
  const sessions = sessionRows[0] ?? {};

  const metaRows = (await sql`
    select
      count(distinct session_id)::int as total,
      count(distinct session_id) filter (where properties->>'utm_source' = 'meta')::int as meta
    from product_events
    where event_name = 'signup_page_view' and created_at >= ${since}::date
      and coalesce(properties->>'bot', '') <> 'true'
  `) as Counts[];
  const meta = metaRows[0] ?? {};

  const firstViewRows = (await sql`
    select to_char(min(created_at) at time zone 'America/Mexico_City', 'YYYY-MM-DD') as day
    from product_events
    where event_name = 'signup_page_view'
  `) as Counts[];
  const firstViewDay = (firstViewRows[0]?.day as string | null) ?? null;

  const restaurantEventRows = (await sql`
    select
      count(distinct pe.restaurant_id) filter (where pe.event_name = 'onboarding_ready_shown')::int as ready,
      count(distinct pe.restaurant_id) filter (
        where pe.event_name in (
          'mesero_qr_generated', 'card_qr_downloaded', 'card_qr_shared',
          'restaurant_qr_printed', 'restaurant_qr_downloaded', 'restaurant_qr_shared',
          'qr_fullscreen_opened', 'whatsapp_share_clicked'
        )
           or (pe.event_name = 'review_page_open' and pe.properties->>'has_card' = 'false')
      )::int as qr
    from product_events pe
    join restaurants r on r.id = pe.restaurant_id
    where r.created_at >= ${since}::date
      and coalesce(pe.properties->>'bot', '') <> 'true'
  `) as Counts[];
  const restaurantEvents = restaurantEventRows[0] ?? {};

  const num = (value: unknown): number => Number(value ?? 0);

  let previous: number | null = null;
  const step = (label: string, value: number, asDenominator = true) => {
    const base = previous;
    console.log(
      `  ${label.padEnd(28)}${String(value).padStart(6)}${
        base === null ? '' : `   ${pct(value, base)}`
      }`,
    );
    if (asDenominator) previous = value;
  };

  console.log('');
  console.log(`Funnel /contacto -> pago (desde ${since}):`);
  step('Vieron /contacto', num(sessions.viewed));
  step('Empezaron el formulario', num(sessions.started));
  step('Eligieron su negocio en Google', num(sessions.place_selected));
  step('Enviaron', num(sessions.submitted));
  step('Error al enviar', num(sessions.submit_failed), false);
  step('Cuenta creada', n);
  step('Vieron su cuenta lista', num(restaurantEvents.ready));
  step('Google conectado', count((r) => r.google === true));
  step('Primera calificación', count((r) => Number(r.calif) > 0));
  step('Pagando', count((r) => r.pago === 'authorized'));
  console.log(`  Info: con meseros          ${count((r) => Number(r.meseros) > 0)}`);
  console.log(`  Info: QR descargado/compartido ${num(restaurantEvents.qr)}`);
  console.log(
    `  Info: emails abiertos ${count((r) => Number(r.aperturas) > 0)} · con clic ${count((r) => Number(r.clics) > 0)} (trials; sin bots)`,
  );

  const totalSessions = num(meta.total);
  const metaSessions = num(meta.meta);
  console.log(
    `  Sesiones de /contacto: Meta ${metaSessions} · otras ${Math.max(0, totalSessions - metaSessions)}`,
  );
  console.log(
    firstViewDay
      ? `Eventos de /contacto desde ${firstViewDay}`
      : 'Eventos de /contacto desde — (sin eventos signup_page_view)',
  );
}

/**
 * Every event that belongs to one restaurant: its own rows plus every row from
 * the session ids seen on those rows (the anonymous /contacto steps), with DB
 * milestones interleaved. All timestamps are America/Mexico_City.
 */
async function printTimeline(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>,
  slug: string,
) {
  const target = (await sql`
    select id, slug, name from restaurants where slug = ${slug} limit 1
  `) as Array<{ id: number; slug: string; name: string }>;

  const restaurant = target[0];
  if (!restaurant) {
    console.error(`error: no restaurant with slug "${slug}"`);
    process.exit(1);
  }

  const rows = (await sql`
    with target as (
      select id, slug, created_at from restaurants where slug = ${slug} limit 1
    ),
    sessions as (
      select distinct session_id
      from product_events
      where restaurant_id = (select id from target) and session_id is not null
    ),
    timeline as (
      select pe.created_at as at, pe.event_name as event, pe.role as role,
             pe.path as path, pe.properties as properties
        from product_events pe
       where pe.restaurant_id = (select id from target)
          or pe.session_id in (select session_id from sessions)
      union all
      select r.created_at, 'restaurant_created', 'owner', null,
             jsonb_build_object('slug', r.slug)
        from target r
      union all
      select s.ts, 'first_staff_created', 'staff', null, jsonb_build_object('count', s.n)
        from (select min(created_at) as ts, count(*)::int as n
                from staff where restaurant_id = (select id from target)) s
       where s.ts is not null
      union all
      select v.ts, 'first_review', null, null, jsonb_build_object('count', v.n)
        from (select min(created_at) as ts, count(*)::int as n
                from reviews where restaurant_id = (select id from target)) v
       where v.ts is not null
      union all
      select p.updated_at, 'mercadopago_subscription', null, null,
             jsonb_build_object('status', p.status)
        from (select status, updated_at from mercadopago_subscriptions
               where restaurant_id = (select id from target)
               order by id desc limit 1) p
    )
    select to_char(at at time zone 'America/Mexico_City', 'MM-DD HH24:MI:SS') as time,
           event, role, path, properties
      from timeline
     order by at, event
  `) as Array<Record<string, unknown>>;

  console.log(`Timeline de ${restaurant.name} (${restaurant.slug}) — America/Mexico_City\n`);
  console.log(
    'tiempo'.padEnd(16) + 'evento'.padEnd(30) + 'rol'.padEnd(10) + 'path'.padEnd(62) + 'properties',
  );
  console.log('-'.repeat(140));
  if (rows.length === 0) {
    console.log('(sin eventos)');
    return;
  }
  for (const row of rows) {
    console.log(
      String(row.time ?? '').padEnd(16) +
        truncate(row.event, 29).padEnd(30) +
        truncate(row.role, 9).padEnd(10) +
        truncate(row.path, 60).padEnd(62) +
        truncate(row.properties, 80),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

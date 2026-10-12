/**
 * Owner-side trial funnel for paid acquisition: which ad brought each
 * self-serve signup, and how far each trial got toward paying.
 *
 *   npm run trial:funnel                       signups since 2026-10-12 (Meta launch)
 *   npm run trial:funnel -- --since 2026-10-01
 *
 * Stages per restaurant (each a fact in the DB, nothing inferred):
 *   Google   google_place_id or google_review_url set (guests can be sent to Google)
 *   Meseros  active staff rows
 *   Calif    submitted guest ratings
 *   Pago     latest Mercado Pago subscription status
 * Source is the signup's commercial lead UTM (utm_source/utm_content).
 */
process.env.DOTENV_CONFIG_QUIET ??= 'true';
import { config } from 'dotenv';

config({ path: '.env.local' });

const LAUNCH = '2026-10-12';

function sinceArg(): string {
  const i = process.argv.indexOf('--since');
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : LAUNCH;
}

async function main() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL!);
  const since = sinceArg();

  const rows = (await sql`
    select r.slug,
           to_char(r.created_at at time zone 'America/Mexico_City', 'MM-DD HH24:MI') as creado,
           coalesce(cl.utm_source, '-') as fuente,
           coalesce(cl.utm_content, '-') as anuncio,
           (r.google_place_id is not null or r.google_review_url is not null) as google,
           (select count(*)::int from staff s where s.restaurant_id = r.id and s.active) as meseros,
           (select count(*)::int from reviews v where v.restaurant_id = r.id) as calif,
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
  console.log(`  Con meseros        ${count((r) => Number(r.meseros) > 0)}`);
  console.log(`  Con calificaciones ${count((r) => Number(r.calif) > 0)}`);
  console.log(`  Pagando            ${count((r) => r.pago === 'authorized' || r.estado === 'active')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

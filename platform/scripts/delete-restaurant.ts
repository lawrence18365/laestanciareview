// Delete a restaurant account and everything that cascades from it.
//
// Every FK that references restaurants is ON DELETE CASCADE (reviews, staff,
// guests, guest_visits, quotes, event_leads, campaigns, push_subscriptions,
// google_rating_snapshots, password_reset_tokens) or SET NULL (product_events,
// commercial_events, pending_signups). So one delete removes the account and
// all of its operating history.
//
// This is irreversible. The dry run prints exactly what would be destroyed and
// requires the slug to be named twice: once with --slug and again with
// --confirm, so a mistyped slug cannot delete the wrong restaurant.
//
// Usage:
//   npx tsx scripts/delete-restaurant.ts --slug el-braserio
//   npx tsx scripts/delete-restaurant.ts --slug el-braserio --confirm el-braserio --apply
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });

const USAGE = `Usage:
  npx tsx scripts/delete-restaurant.ts --slug <slug>                          # dry run
  npx tsx scripts/delete-restaurant.ts --slug <slug> --confirm <slug> --apply # delete

Options:
  --slug <slug>     Account to delete
  --confirm <slug>  Must match --slug exactly; required with --apply
  --apply           Actually delete (default is a dry run)
  --help            Show this help`;

const sql = neon(process.env.DATABASE_URL!);

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const slug = arg('--slug');
  if (!slug) {
    console.error('--slug is required\n');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const found = await sql`select id, name, slug, is_owner, is_regional from restaurants where slug = ${slug} limit 1`;
  if (found.length === 0) {
    console.error(`No restaurant with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }

  const r = found[0];
  const id = r.id as number;

  if (r.is_owner || r.is_regional) {
    console.error(`"${slug}" is an owner/regional account, not a location. Refusing.`);
    process.exitCode = 1;
    return;
  }

  const [counts] = await sql`select
    (select count(*) from reviews where restaurant_id=${id})::int reviews,
    (select count(*) from staff where restaurant_id=${id})::int staff,
    (select count(*) from guests where restaurant_id=${id})::int guests,
    (select count(*) from guest_visits where restaurant_id=${id})::int visits,
    (select count(*) from quotes where restaurant_id=${id})::int quotes,
    (select count(*) from event_leads where restaurant_id=${id})::int event_leads,
    (select count(*) from push_subscriptions where restaurant_id=${id})::int devices,
    (select count(*) from google_rating_snapshots where restaurant_id=${id})::int snapshots,
    (select count(*) from product_events where restaurant_id=${id})::int product_events`;

  console.log(`\n${r.name}  (slug: ${r.slug}, id: ${id})\n`);
  console.log('  Rows that will be destroyed:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`      ${k.padEnd(16)} ${v}`);
  }

  const confirm = arg('--confirm');
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('\nDry run. Nothing deleted.');
    console.log(`To delete: --slug ${slug} --confirm ${slug} --apply`);
    return;
  }

  if (confirm !== slug) {
    console.error(`\n--confirm must exactly match --slug ("${slug}"). Got "${confirm ?? ''}". Refusing.`);
    process.exitCode = 1;
    return;
  }

  const deleted = await sql`delete from restaurants where id = ${id} returning slug`;
  if (deleted.length === 1) {
    console.log(`\n✓ Deleted "${deleted[0].slug}" and all cascaded rows.`);
  } else {
    console.error(`\n✗ Expected to delete 1 row, deleted ${deleted.length}.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

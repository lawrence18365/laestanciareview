/**
 * Audit: historical subscription status breakdown + recoverable churn candidates.
 * Usage: npx tsx scripts/audit-subscription-status.ts
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

async function main() {
  const { db } = await import('../src/db');
  const { restaurants } = await import('../src/db/schema');
  const { sql, inArray } = await import('drizzle-orm');

  // ── 1. Status breakdown ────────────────────────────────────────────────────
  const [counts] = await db
    .select({
      total:       sql<number>`count(*)`,
      active:      sql<number>`count(*) filter (where subscription_status = 'active')`,
      trialing:    sql<number>`count(*) filter (where subscription_status = 'trialing')`,
      pastDue:     sql<number>`count(*) filter (where subscription_status = 'past_due')`,
      canceled:    sql<number>`count(*) filter (where subscription_status = 'canceled')`,
    })
    .from(restaurants);

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  AUDIT: Subscription status + churn pool');
  console.log('══════════════════════════════════════════════════════\n');
  console.log(`  Total restaurants:   ${counts.total}`);
  console.log(`  Active (paying):     ${counts.active}`);
  console.log(`  Trialing:            ${counts.trialing}`);
  console.log(`  ⚠️  Past due:         ${counts.pastDue}  ← recoverable with portal fix`);
  console.log(`  ✗  Canceled:         ${counts.canceled}  ← check if reachable`);
  console.log('');

  // ── 2. Past-due rows (recoverable right now) ───────────────────────────────
  const pastDue = await db
    .select({
      id:                 restaurants.id,
      name:               restaurants.name,
      managerEmail:       restaurants.managerEmail,
      stripeCustomerId:   restaurants.stripeCustomerId,
      createdAt:          restaurants.createdAt,
    })
    .from(restaurants)
    .where(sql`subscription_status = 'past_due'`);

  if (pastDue.length > 0) {
    console.log('  Past-due customers (portal button will now work for them):');
    for (const r of pastDue) {
      const noPortal = !r.stripeCustomerId ? ' ⚠️  NO stripeCustomerId — portal will 404' : '';
      console.log(
        `  [${String(r.id).padStart(4)}] ${r.name}`
        + `\n         email:  ${r.managerEmail ?? '(none)'}`
        + `\n         stripe: ${r.stripeCustomerId ?? '(null)'}${noPortal}`
        + `\n         since:  ${r.createdAt?.toISOString().slice(0, 10)}`
      );
    }
  }

  // ── 3. Canceled rows with an email (potentially reachable for win-back) ────
  const canceled = await db
    .select({
      id:           restaurants.id,
      name:         restaurants.name,
      managerEmail: restaurants.managerEmail,
      createdAt:    restaurants.createdAt,
    })
    .from(restaurants)
    .where(sql`subscription_status = 'canceled' and manager_email is not null`);

  if (canceled.length > 0) {
    console.log(`\n  Canceled with email (win-back candidates): ${canceled.length}`);
    for (const r of canceled) {
      console.log(`  [${String(r.id).padStart(4)}] ${r.name} — ${r.managerEmail} (signed up ${r.createdAt?.toISOString().slice(0, 10)})`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

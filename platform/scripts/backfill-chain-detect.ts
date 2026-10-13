/**
 * One-off chain detection (US-15 M5) for self-serve trials that signed up
 * before it shipped: restaurants with group_key NULL and no `chainCount` yet.
 *
 * Dry-run by default: runs the Places search and prints what it would store
 * and which founders alerts it would send. Nothing is written or emailed.
 * With --apply: stores `google_profile.chainCount` and sends the founder alert
 * at 3+ locations (the same path as a new signup).
 *
 * Costs one Places Text Search Pro call per restaurant (about US$0.032).
 * Group restaurants (group_key set) are never touched.
 *
 * Usage:
 *   npx tsx scripts/backfill-chain-detect.ts            # dry run
 *   npx tsx scripts/backfill-chain-detect.ts --apply    # write + alert
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

const APPLY = process.argv.includes('--apply');
const DELAY_MS = 250;

async function main() {
  const [{ db }, { restaurants }, { detectChain }, { recordChainDetection, CHAIN_ALERT_THRESHOLD }, orm] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/schema'),
      import('../src/lib/chain-detect'),
      import('../src/lib/signup-provisioning'),
      import('drizzle-orm'),
    ]);
  const { and, eq, isNull, sql } = orm;

  const rows = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
      groupKey: restaurants.groupKey,
      googlePlaceId: restaurants.googlePlaceId,
      city: restaurants.city,
      contactName: restaurants.contactName,
      email: restaurants.managerEmail,
      phone: restaurants.managerPhone,
    })
    .from(restaurants)
    .where(
      and(
        isNull(restaurants.groupKey),
        eq(restaurants.subscriptionStatus, 'trialing'),
        sql`(${restaurants.googleProfile} is null or ${restaurants.googleProfile} -> 'chainCount' is null)`,
      ),
    );

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} self-serve trial(s) to check.`);

  let alerts = 0;
  for (const r of rows) {
    if (r.groupKey !== null) continue; // belt and braces; the query already excludes them
    let count: number | null;
    if (APPLY) {
      count = await recordChainDetection(r);
    } else {
      count = (await detectChain(r.name, r.googlePlaceId ?? ''))?.count ?? null;
    }
    const flag = count !== null && count >= CHAIN_ALERT_THRESHOLD;
    if (flag) alerts++;
    console.log(
      `${r.slug}\t${r.name}\tcount=${count ?? 'n/a'}${flag ? (APPLY ? '\tALERT SENT' : '\tWOULD ALERT') : ''}`,
    );
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  console.log(`Done. ${alerts} possible chain(s)${APPLY ? '' : ' (dry run: nothing written or sent)'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

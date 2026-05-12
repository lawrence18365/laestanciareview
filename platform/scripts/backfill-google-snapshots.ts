/**
 * Force a fresh Google rating snapshot for every restaurant now.
 * Run once after deploy so the "Google hoy" diff has a baseline to compare
 * against tomorrow, instead of waiting for the next cron fire.
 *
 * Usage: npx tsx scripts/backfill-google-snapshots.ts
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

async function main() {
  const { refreshAllGoogleRatings } = await import('../src/lib/google-places');
  const result = await refreshAllGoogleRatings(0);
  console.log(`Snapshotted ${result.updated}/${result.total} restaurants.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

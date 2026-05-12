/**
 * Apply the Guest Capture CRM migration and verify the brand backfill.
 *
 * Pinned to .env.local (dev branch) — does NOT load .env.production.local.
 * Idempotent: safe to re-run.
 *
 * Usage: npx tsx scripts/apply-guest-migration.ts
 */
import { config } from 'dotenv';
// ENV_FILE lets the same script target dev (.env.local) or prod (.env.production.local)
// without ever loading both. Defaults to dev.
const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'node:fs';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing — is .env.local loaded?');

  const masked = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@').replace(/\?.*$/, '?…');
  console.log(`Target: ${masked}`);

  const pool = new Pool({ connectionString: url });

  try {
    // --- preflight ---
    const preflight = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_owner)::int AS owners,
        COUNT(*) FILTER (WHERE is_regional)::int AS regionals
      FROM restaurants;
    `);
    console.log('Preflight restaurants:', preflight.rows[0]);

    const hasBrand = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='restaurants' AND column_name='brand';
    `);
    console.log('brand column already exists?', (hasBrand.rowCount ?? 0) > 0);

    const guestTables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('guests','guest_visits');
    `);
    console.log('guest tables already exist:', guestTables.rows.map((r: { table_name: string }) => r.table_name));

    // --- run migration ---
    console.log('\n--- Applying 0002_guest_capture.sql ---');
    const sql = fs.readFileSync('src/db/migrations/0002_guest_capture.sql', 'utf8');
    await pool.query(sql);
    console.log('Migration applied.');

    // --- post-migration verification ---
    console.log('\n--- Verification ---');

    const backfill = await pool.query(`
      SELECT slug, brand, is_owner, is_regional
      FROM restaurants
      ORDER BY is_owner DESC, is_regional DESC, slug;
    `);
    console.table(backfill.rows);

    const missing = backfill.rows.filter(
      (r: { brand: string | null; is_owner: boolean; is_regional: boolean }) =>
        !r.brand && !r.is_owner && !r.is_regional,
    );
    if (missing.length > 0) {
      console.warn(`\n⚠️  ${missing.length} non-owner/non-regional restaurant(s) have NULL brand.`);
      console.warn('These rows will show the "not configured" screen on /g/<slug>.');
      console.warn('Fix with UPDATE statements keyed on slug before the demo.');
    } else {
      console.log('\n✓ All non-owner/non-regional restaurants have a brand set.');
    }

    const guestCount = await pool.query('SELECT COUNT(*)::int FROM guests');
    const visitCount = await pool.query('SELECT COUNT(*)::int FROM guest_visits');
    console.log(`guests: ${guestCount.rows[0].count} | guest_visits: ${visitCount.rows[0].count}`);

    const enums = await pool.query(`
      SELECT typname FROM pg_type
      WHERE typname IN ('guest_status','redemption_type')
      ORDER BY typname;
    `);
    console.log('enums:', enums.rows.map((r: { typname: string }) => r.typname));

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname='public'
        AND (tablename IN ('guests','guest_visits') OR indexname='restaurants_brand_idx')
      ORDER BY indexname;
    `);
    console.log('indexes:', indexes.rows.map((r: { indexname: string }) => r.indexname));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

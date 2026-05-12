/**
 * Post-deploy data safety audit.
 *
 * Verifies that the Guest Capture migration + smoke test did not damage,
 * modify, or leave residue in any existing customer data. Read-only.
 *
 * Usage: ENV_FILE=.env.production.local npx tsx scripts/audit-neon-safety.ts
 */
import { config } from 'dotenv';
const envFile = process.env.ENV_FILE ?? '.env.production.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

async function q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function main() {
  console.log(`Auditing: ${envFile}\n`);

  // --- 1. Every user table: row count ---
  console.log('=== 1. Row counts per table ===');
  const tables = [
    'restaurants',
    'staff',
    'reviews',
    'push_subscriptions',
    'google_rating_snapshots',
    'processed_stripe_events',
    'prospect_queue',
    'prospect_views',
    'nurture_events',
    'guests',
    'guest_visits',
  ];
  for (const t of tables) {
    try {
      const r = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      console.log(`  ${t.padEnd(28)} ${r[0].n}`);
    } catch (err) {
      console.log(`  ${t.padEnd(28)} ERROR: ${(err as Error).message}`);
    }
  }

  // --- 2. Every restaurant with core fields intact ---
  console.log('\n=== 2. Restaurant integrity (slug + name + google fields) ===');
  const restaurants = await q<{
    id: number;
    slug: string;
    name: string;
    google_place_id: string | null;
    google_review_url: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string;
    brand: string | null;
    is_owner: boolean;
    is_regional: boolean;
  }>(`
    SELECT id, slug, name, google_place_id, google_review_url,
           stripe_customer_id, stripe_subscription_id, subscription_status,
           brand, is_owner, is_regional
    FROM restaurants
    ORDER BY is_owner DESC, is_regional DESC, slug
  `);
  for (const r of restaurants) {
    const role = r.is_owner ? '[OWNER]' : r.is_regional ? '[REGIONAL]' : '[GM]';
    const sub = r.subscription_status.padEnd(10);
    const stripe = r.stripe_customer_id ? 'stripe✓' : 'stripe✗';
    const google = r.google_review_url ? 'google✓' : 'google✗';
    console.log(`  ${role.padEnd(11)} ${r.slug.padEnd(24)} ${sub} ${stripe} ${google} brand=${r.brand ?? 'NULL'}`);
  }

  // --- 3. Sample: reviews table unaltered ---
  console.log('\n=== 3. Reviews — historical data intact? ===');
  const reviewAgg = await q<{
    total: number;
    earliest: string;
    latest: string;
    distinct_restaurants: number;
  }>(`
    SELECT COUNT(*)::int AS total,
           MIN(created_at)::text AS earliest,
           MAX(created_at)::text AS latest,
           COUNT(DISTINCT restaurant_id)::int AS distinct_restaurants
    FROM reviews
  `);
  console.log(`  total reviews: ${reviewAgg[0].total}`);
  console.log(`  earliest:      ${reviewAgg[0].earliest}`);
  console.log(`  latest:        ${reviewAgg[0].latest}`);
  console.log(`  across:        ${reviewAgg[0].distinct_restaurants} restaurants`);

  // --- 4. Staff counts per restaurant ---
  console.log('\n=== 4. Staff coverage ===');
  const staffByRestaurant = await q<{ slug: string; staff_count: number; active_count: number }>(`
    SELECT r.slug,
           COUNT(s.id)::int AS staff_count,
           COUNT(*) FILTER (WHERE s.active)::int AS active_count
    FROM restaurants r
    LEFT JOIN staff s ON s.restaurant_id = r.id
    WHERE r.is_owner = false AND r.is_regional = false
    GROUP BY r.slug
    ORDER BY r.slug
  `);
  for (const row of staffByRestaurant) {
    console.log(`  ${row.slug.padEnd(24)} ${row.staff_count} total, ${row.active_count} active`);
  }

  // --- 5. Residue check for smoke-test rows ---
  console.log('\n=== 5. Residue check (smoke test cleanup) ===');
  const residueName = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM guests WHERE name ILIKE '%smoke%' OR name ILIKE '%alice%' OR name ILIKE '%bob%'`,
  );
  const residuePhone = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM guests WHERE whatsapp IN ('525512300001', '525512300002')`,
  );
  const residueVisits = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM guest_visits`,
  );
  console.log(`  guests with smoke-test names:    ${residueName[0].n}  (should be 0)`);
  console.log(`  guests with test phone numbers:  ${residuePhone[0].n}  (should be 0)`);
  console.log(`  guest_visits total:              ${residueVisits[0].n}  (should be 0)`);

  // --- 6. Schema integrity: restaurants columns intact ---
  console.log('\n=== 6. restaurants schema — no dropped columns ===');
  const cols = await q<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='restaurants' AND table_schema='public'
    ORDER BY ordinal_position
  `);
  const expected = [
    'id', 'name', 'slug', 'manager_email', 'google_review_url', 'google_threshold',
    'admin_password_hash', 'is_owner', 'is_regional', 'region', 'brand',
    'manager_phone', 'alert_preference', 'sms_alerts', 'whatsapp_alerts',
    'callmebot_api_key', 'google_place_id', 'google_rating', 'google_review_count',
    'google_rating_updated_at', 'contact_name', 'city', 'stripe_customer_id',
    'stripe_subscription_id', 'subscription_status', 'trial_ends_at',
    'shipping_address', 'nfc_cards_shipped_at', 'created_at',
  ];
  const actual = cols.map((c) => c.column_name);
  const missing = expected.filter((e) => !actual.includes(e));
  const extra = actual.filter((a) => !expected.includes(a));
  console.log(`  columns: ${actual.length} (expected ${expected.length})`);
  if (missing.length > 0) console.log(`  ⚠️  MISSING: ${missing.join(', ')}`);
  if (extra.length > 0) console.log(`  ⚠️  UNEXPECTED extras: ${extra.join(', ')}`);
  if (missing.length === 0 && extra.length === 0) console.log(`  ✓ all expected columns present, none dropped, none extra`);

  // --- 7. Foreign key integrity ---
  console.log('\n=== 7. FK integrity (orphans) ===');
  const orphanReviews = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reviews r LEFT JOIN restaurants x ON x.id=r.restaurant_id WHERE x.id IS NULL`,
  );
  const orphanStaff = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM staff s LEFT JOIN restaurants x ON x.id=s.restaurant_id WHERE x.id IS NULL`,
  );
  const orphanSnapshots = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM google_rating_snapshots g LEFT JOIN restaurants x ON x.id=g.restaurant_id WHERE x.id IS NULL`,
  );
  console.log(`  orphan reviews:            ${orphanReviews[0].n}  (must be 0)`);
  console.log(`  orphan staff:              ${orphanStaff[0].n}  (must be 0)`);
  console.log(`  orphan google snapshots:   ${orphanSnapshots[0].n}  (must be 0)`);

  // --- 8. New-schema sanity ---
  console.log('\n=== 8. New schema elements ===');
  const enums = await q<{ typname: string; n: number }>(`
    SELECT t.typname, COUNT(e.enumlabel)::int AS n
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('guest_status', 'redemption_type', 'review_status')
    GROUP BY t.typname
    ORDER BY t.typname
  `);
  for (const e of enums) console.log(`  enum ${e.typname}: ${e.n} values`);

  const newIndexes = await q<{ indexname: string }>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public'
      AND (tablename IN ('guests','guest_visits') OR indexname='restaurants_brand_idx')
    ORDER BY indexname
  `);
  console.log(`  new indexes: ${newIndexes.length} (${newIndexes.map((i) => i.indexname).join(', ')})`);

  // --- 9. Any guest_visits that orphan a guest? ---
  const orphanVisits = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM guest_visits v LEFT JOIN guests g ON g.id = v.guest_id WHERE g.id IS NULL`,
  );
  console.log(`  orphan guest_visits: ${orphanVisits[0].n}  (must be 0)`);

  console.log('\n✅ Audit complete.');
}

main()
  .catch((err) => { console.error('❌ AUDIT FAILED:', err); process.exit(1); })
  .finally(() => pool.end());

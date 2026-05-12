/**
 * End-to-end smoke test for the Guest Capture CRM.
 *
 * Exercises: capture → dedup recapture → validate → already-validated →
 * second guest. Inserts test rows, verifies DB state at each step, deletes
 * the test rows on the way out.
 *
 * Pinned to .env.local. Requires `npm run dev` to be running on :3000.
 *
 * Usage: npx tsx scripts/smoke-guest-capture.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const BASE_URL = 'http://localhost:3000';
const SLUG = 'estancia-leon';
// Pre-normalised (already 12-digit MX form), so DB rows match these exactly.
const ALICE = '525512300001';
const BOB = '525512300002';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

async function q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function postCapture(name: string, whatsapp: string) {
  const r = await fetch(`${BASE_URL}/api/v1/guests/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurantSlug: SLUG,
      name,
      whatsapp,
      birthdayMmdd: '15/06',
      preferences: ['Vino', 'Carne'],
      marketingConsent: true,
      promoType: 'wine',
    }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function postValidate(code: string, staffCode: string) {
  const r = await fetch(`${BASE_URL}/api/v1/guests/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurantSlug: SLUG,
      code,
      staffCode,
      redemptionType: 'copa_vino',
      notes: 'smoke',
    }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  // --- setup: clean any leftover test rows ---
  await q(`DELETE FROM guests WHERE whatsapp IN ($1, $2)`, [ALICE, BOB]);

  const rs = await q<{ id: number; brand: string | null }>(
    `SELECT id, brand FROM restaurants WHERE slug=$1`,
    [SLUG],
  );
  if (!rs[0]) throw new Error(`Restaurant "${SLUG}" not found`);
  const restaurantId = rs[0].id;
  console.log(`Restaurant: ${SLUG} (id=${restaurantId}, brand=${rs[0].brand})`);

  const staff = await q<{ code: string; name: string }>(
    `SELECT code, name FROM staff WHERE restaurant_id=$1 AND active=true ORDER BY id LIMIT 1`,
    [restaurantId],
  );
  if (!staff[0]) throw new Error(`No active staff at ${SLUG} — cannot test validate`);
  const staffCode = staff[0].code;
  console.log(`Using staff: ${staff[0].name} (code=${staffCode})\n`);

  // --- 1. First capture ---
  console.log('1. First capture (Alice)');
  const cap1 = await postCapture('Smoke Alice', ALICE);
  console.log(`   → ${cap1.status}`, cap1.body);
  assert(cap1.status === 200, 'first capture returns 200');
  assert(cap1.body.isNew === true, 'first capture is flagged isNew');
  const code1 = cap1.body.validationCode as string;
  assert(/^\d{4}$/.test(code1), 'validation code is 4 digits');

  const s1 = await q<{ status: string; validation_code: string; name: string; visits: string }>(
    `SELECT g.status, g.validation_code, g.name,
            (SELECT COUNT(*) FROM guest_visits WHERE guest_id=g.id) AS visits
     FROM guests g WHERE whatsapp=$1`,
    [ALICE],
  );
  console.log('   DB:', s1[0]);
  assert(s1.length === 1, 'exactly one guest row after first capture');
  assert(s1[0].status === 'pending_validation', 'status is pending_validation');
  assert(s1[0].validation_code === code1, 'DB code matches returned code');
  assert(Number(s1[0].visits) === 1, 'visit count is 1');

  // --- 2. Recapture (dedup) ---
  console.log('\n2. Recapture same WhatsApp (dedup)');
  const cap2 = await postCapture('Smoke Alice Changed', ALICE);
  console.log(`   → ${cap2.status}`, cap2.body);
  assert(cap2.status === 200, 'recapture returns 200');
  assert(cap2.body.isNew === false, 'recapture is flagged isNew=false');
  const code2 = cap2.body.validationCode as string;
  assert(code2 !== code1, 'code regenerated on recapture');

  const s2 = await q<{ name: string; validation_code: string; visits: string }>(
    `SELECT g.name, g.validation_code,
            (SELECT COUNT(*) FROM guest_visits WHERE guest_id=g.id) AS visits
     FROM guests g WHERE whatsapp=$1`,
    [ALICE],
  );
  console.log('   DB:', s2[0]);
  assert(s2.length === 1, 'still one guest row (dedup)');
  assert(s2[0].name === 'Smoke Alice Changed', 'name updated to most recent capture');
  assert(s2[0].validation_code === code2, 'DB code is the new one');
  assert(Number(s2[0].visits) === 2, 'visit count incremented to 2');

  // --- 3. Validate ---
  console.log('\n3. Validate the current code');
  const val1 = await postValidate(code2, staffCode);
  console.log(`   → ${val1.status}`, val1.body);
  assert(val1.status === 200, 'validate returns 200');
  assert(val1.body.guestName === 'Smoke Alice Changed', 'returns latest guest name');

  const s3 = await q<{
    status: string;
    redemption_type: string;
    validated_by: number;
    visits: string;
    visits_with_staff: string;
  }>(
    `SELECT g.status, g.redemption_type, g.validated_by,
            (SELECT COUNT(*) FROM guest_visits WHERE guest_id=g.id) AS visits,
            (SELECT COUNT(*) FROM guest_visits WHERE guest_id=g.id AND logged_by IS NOT NULL) AS visits_with_staff
     FROM guests g WHERE whatsapp=$1`,
    [ALICE],
  );
  console.log('   DB:', s3[0]);
  assert(s3[0].status === 'validated', 'status flipped to validated');
  assert(s3[0].redemption_type === 'copa_vino', 'redemption_type recorded');
  assert(s3[0].validated_by !== null, 'validated_by staff id recorded');
  assert(Number(s3[0].visits) === 2, 'visits still 2 (no double-count on validate)');
  assert(
    Number(s3[0].visits_with_staff) === 1,
    'one visit has logged_by staff (the most recent, upgraded on validate)',
  );

  // --- 4. Re-validate same code ---
  console.log('\n4. Re-validate same code (should 409)');
  const val2 = await postValidate(code2, staffCode);
  console.log(`   → ${val2.status}`, val2.body);
  assert(val2.status === 409, 're-validation blocked with 409');

  // --- 5. Second guest, same brand ---
  console.log('\n5. Capture a second guest (Bob, different WhatsApp)');
  const cap3 = await postCapture('Smoke Bob', BOB);
  console.log(`   → ${cap3.status}`, cap3.body);
  assert(cap3.status === 200, 'second guest capture returns 200');
  assert(cap3.body.isNew === true, 'Bob is a new guest');

  const s5 = await q<{ whatsapp: string; name: string; status: string }>(
    `SELECT whatsapp, name, status FROM guests WHERE whatsapp IN ($1, $2) ORDER BY whatsapp`,
    [ALICE, BOB],
  );
  console.log('   DB:', s5);
  assert(s5.length === 2, 'two distinct guest rows');

  // --- 6. Export endpoint smoke (unauthed, should 401) ---
  console.log('\n6. Export endpoint (unauthed, should 401)');
  const exp = await fetch(`${BASE_URL}/api/v1/guests/export`);
  console.log(`   → ${exp.status}`);
  assert(exp.status === 401, 'export rejects unauth request');

  // --- cleanup ---
  console.log('\n--- Cleanup ---');
  await q(`DELETE FROM guests WHERE whatsapp IN ($1, $2)`, [ALICE, BOB]);
  console.log('Test rows removed.');

  console.log('\n✅ All assertions passed.');
}

main()
  .catch((err) => {
    console.error('\n❌ FAILED:', err);
    process.exit(1);
  })
  .finally(() => pool.end());

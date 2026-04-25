import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log('─── Existing quotes in prod ───────');
  const existing = await sql`
    SELECT id, quote_number, status, client_name, package_name, guest_count,
           price_per_person, service_charge_percent, iva_percent,
           (config_json IS NOT NULL) AS has_config_json,
           created_at
    FROM quotes ORDER BY created_at DESC LIMIT 20
  `;
  console.log(`count=${existing.length}`);
  for (const q of existing) console.log(q);

  console.log('\n─── Restaurants using Estancia brand ───');
  const ests = await sql`
    SELECT id, name, slug, brand, manager_email, subscription_status,
           (admin_password_hash IS NOT NULL) AS has_password
    FROM restaurants
    WHERE brand = 'estancia' OR slug LIKE 'estancia%' OR slug LIKE '%estancia%'
    ORDER BY id
  `;
  for (const r of ests) console.log(r);

  console.log('\n─── Staff rows for those restaurants ───');
  const staff = await sql`
    SELECT s.id, s.restaurant_id, s.name, s.code, s.active, r.slug
    FROM staff s JOIN restaurants r ON r.id = s.restaurant_id
    WHERE r.brand = 'estancia' OR r.slug LIKE '%estancia%'
    ORDER BY s.restaurant_id, s.id
    LIMIT 30
  `;
  console.log(`staff count=${staff.length}`);
  for (const s of staff) console.log(s);

  console.log('\n─── Column check: is there any createdBy on quotes? ───');
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'quotes' ORDER BY ordinal_position
  `;
  console.log(cols.map((c: { column_name: string }) => c.column_name).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });

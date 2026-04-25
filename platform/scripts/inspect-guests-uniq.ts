import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log('─── Row count ─────────────────');
  const count = await sql`SELECT COUNT(*)::int AS n FROM guests`;
  console.log('guests rows:', count[0]);

  console.log('\n─── Unique INDEXES on guests ──');
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'guests'
  `;
  console.log(idx);

  console.log('\n─── Unique CONSTRAINTS on guests ──');
  const cons = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'guests'::regclass AND contype = 'u'
  `;
  console.log(cons);

  console.log('\n─── Duplicate check (whatsapp + brand) ──');
  const dupes = await sql`
    SELECT whatsapp, brand, COUNT(*)::int AS n
    FROM guests
    GROUP BY whatsapp, brand
    HAVING COUNT(*) > 1
  `;
  console.log(dupes.length === 0 ? 'no duplicates' : dupes);
}

main().catch((e) => { console.error(e); process.exit(1); });

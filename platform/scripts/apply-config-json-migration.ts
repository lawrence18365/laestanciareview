import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const sql = neon(url);

  const exists = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'quotes' AND column_name = 'config_json'
  `;
  if (exists.length > 0) {
    console.log('config_json column already exists on quotes — nothing to do');
    return;
  }

  console.log('Adding config_json jsonb column to quotes…');
  await sql`ALTER TABLE "quotes" ADD COLUMN "config_json" jsonb`;
  console.log('Done.');

  // Verify
  const after = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'quotes' AND column_name = 'config_json'
  `;
  console.log('Post-state:', after);
}

main().catch((e) => { console.error(e); process.exit(1); });

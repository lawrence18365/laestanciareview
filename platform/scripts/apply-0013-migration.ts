/** Apply and verify 0013_event_revenue_campaigns.sql transactionally. */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'node:fs';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);
  const masked = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@').replace(/\?.*$/, '?…');
  console.log(`env: ${envFile}`);
  console.log(`db:  ${masked}`);

  const migration = fs.readFileSync('src/db/migrations/0013_event_revenue_campaigns.sql', 'utf8');
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('event_campaigns','campaign_contacts','campaign_bookings')
    ORDER BY table_name
  `);
  console.log('tables:', tables.rows.map((row: { table_name: string }) => row.table_name).join(', '));
  if (tables.rowCount !== 3) throw new Error('Migration verification failed: expected 3 tables');
  await pool.end();
  console.log('✓ 0013 applied and verified.');
}

main().catch((error) => {
  console.error('✗ 0013 migration failed:', error);
  process.exit(1);
});

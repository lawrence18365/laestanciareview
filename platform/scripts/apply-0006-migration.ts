/**
 * Apply migration 0006_event_leads.sql.
 *
 * Wraps the SQL in BEGIN/COMMIT so a partial failure rolls back. Loads only
 * the env file specified by ENV_FILE (default .env.local) — does not silently
 * fall through to production.
 *
 * Usage:
 *   npx tsx scripts/apply-0006-migration.ts                   # dev
 *   ENV_FILE=.env.production.local npx tsx scripts/apply-0006-migration.ts
 */
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'node:fs';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const masked = url
    .replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
    .replace(/\?.*$/, '?…');
  console.log(`env: ${envFile}`);
  console.log(`db:  ${masked}`);

  const sql = fs.readFileSync(
    'src/db/migrations/0006_event_leads.sql',
    'utf8',
  );

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✓ Migration applied (transactional).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ Migration failed:', err);
  process.exit(1);
});

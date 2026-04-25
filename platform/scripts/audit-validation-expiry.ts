/**
 * Audit pending guest validation codes after the 0005 migration: report any
 * codes whose backfilled expiry has already passed (would be rejected by the
 * new validate route as expired).
 */
import { config } from 'dotenv';
const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);
  const pool = new Pool({ connectionString: url });
  try {
    const res = await pool.query(`
      SELECT
        id,
        name,
        captured_at,
        validation_code_expires_at,
        validation_code_expires_at < now() AS already_expired
      FROM guests
      WHERE status = 'pending_validation'
        AND validation_code IS NOT NULL
      ORDER BY captured_at DESC
    `);
    console.log(`Pending codes: ${res.rowCount}`);
    for (const row of res.rows) {
      const flag = row.already_expired ? '⚠️ already expired' : '✓ still valid';
      console.log(
        `  #${row.id.toString().padEnd(4)} ${flag.padEnd(22)} captured=${row.captured_at.toISOString()}  expires=${row.validation_code_expires_at?.toISOString() ?? '(null)'}  name=${row.name}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

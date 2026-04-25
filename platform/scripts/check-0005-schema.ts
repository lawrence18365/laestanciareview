/**
 * Read-only check for the 0005 migration's expected schema state.
 * Reports whether the new table/column exist; does not modify anything.
 *
 * Usage:
 *   npx tsx scripts/check-0005-schema.ts                    # dev (.env.local)
 *   ENV_FILE=.env.production.local npx tsx scripts/check-0005-schema.ts
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

  const masked = url
    .replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
    .replace(/\?.*$/, '?…');
  console.log(`env: ${envFile}`);
  console.log(`db:  ${masked}`);

  const pool = new Pool({ connectionString: url });
  try {
    const tableRes = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='password_reset_tokens'
    `);
    const colRes = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='guests' AND column_name='validation_code_expires_at'
    `);
    const idxRes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname='public'
        AND indexname IN ('password_reset_tokens_restaurant_idx','password_reset_tokens_expires_idx')
      ORDER BY indexname
    `);

    const hasTable = (tableRes.rowCount ?? 0) > 0;
    const hasColumn = (colRes.rowCount ?? 0) > 0;
    const indexes = idxRes.rows.map((r: { indexname: string }) => r.indexname);

    console.log('---');
    console.log(`password_reset_tokens table:        ${hasTable ? '✓ present' : '✗ missing'}`);
    console.log(`guests.validation_code_expires_at:  ${hasColumn ? '✓ present' : '✗ missing'}`);
    console.log(`indexes (${indexes.length}/2):                     ${indexes.join(', ') || '(none)'}`);

    if (hasColumn) {
      const pendingRes = await pool.query(`
        SELECT
          COUNT(*)::int AS total_pending,
          COUNT(validation_code_expires_at)::int AS with_expiry
        FROM guests
        WHERE status = 'pending_validation' AND validation_code IS NOT NULL
      `);
      const { total_pending, with_expiry } = pendingRes.rows[0];
      console.log(`pending validation codes:           ${total_pending} total, ${with_expiry} with expiry set`);
    } else {
      const pendingRes = await pool.query(`
        SELECT COUNT(*)::int AS total_pending
        FROM guests
        WHERE status = 'pending_validation' AND validation_code IS NOT NULL
      `);
      console.log(`pending validation codes:           ${pendingRes.rows[0].total_pending} total (column not yet present)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

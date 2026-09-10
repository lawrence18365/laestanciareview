import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: '.env.production.local' });
config({ path: '.env.local' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing');

const file = resolve(process.argv[2]);
const sql = readFileSync(file, 'utf8');

// Split on statement boundaries, then strip leading comment lines from each
// chunk before deciding whether it is empty.
//
// The previous version dropped any chunk that merely STARTED with '--', which
// silently skipped the first real statement of every migration that opens with
// a header comment — the statement was never run and the script still printed
// "done". Comments are stripped, not used to discard SQL.
const statements = sql
  .split(/;\s*(?:\n|$)/)
  .map((chunk) => {
    // Drop whole-line comments; leave trailing comments alone so string
    // literals containing '--' are not mangled.
    const withoutLeadingComments = chunk
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    return withoutLeadingComments;
  })
  .filter((stmt) => stmt.length > 0);

const client = neon(url);

(async () => {
  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
    process.stdout.write(`» ${preview}…\n`);
    await client.query(stmt);
  }
  process.stdout.write('done\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

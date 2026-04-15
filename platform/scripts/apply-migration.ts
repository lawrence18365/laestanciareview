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

const statements = sql
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--') && s.replace(/--.*$/gm, '').trim());

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

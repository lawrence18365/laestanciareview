#!/usr/bin/env npx tsx
/**
 * Seed prospect_queue with verified multi-location restaurant GROUPS
 * (tier='group'). These sort first on /prospects and in the founder daily
 * hit list, and get the group-specific WhatsApp opener.
 *
 * Usage:
 *   npx tsx scripts/seed-prospect-groups.ts <file.json> [<file2.json> ...]
 *
 * Input rows (one JSON array per file):
 *   { "name", "email", "source_url", "kind", "place_id", "phone", "rating",
 *     "city", "confidence", "locations", "owner_name", "owner_source_url",
 *     "notes" }
 *
 * place_id: row.place_id when non-empty, else "group:" + slug(name).
 * Rows with no phone AND no email are skipped (and printed).
 *
 * SAFETY (same guarantees as seed-prospect-queue.ts):
 *   - status='identified' ONLY on insert — an existing row's status
 *     (replied/booked/won/...) is never downgraded.
 *   - next_action_at='2099-01-01' on insert so the prospect-outreach cron
 *     can never auto-SMS these rows.
 *   - Everything runs in one transaction.
 */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

const INERT_NEXT_ACTION_AT = '2099-01-01T00:00:00.000Z';

interface GroupRow {
  name?: string;
  email?: string;
  source_url?: string;
  kind?: string;
  place_id?: string;
  phone?: string;
  rating?: string | number;
  city?: string;
  confidence?: string;
  locations?: number;
  owner_name?: string;
  owner_source_url?: string;
  notes?: string;
}

/** lowercase, ascii-folded, non-alphanumerics → '-' */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** digits only; strip a leading '+'; 10-digit Mexican numbers get '52'. */
function normalisePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `52${digits}`;
  return digits;
}

/**
 * Keep only the part before the first '(' or ';' so it reads as a name
 * ("Juan Pérez (fundador); fuente: X" → "Juan Pérez"), truncate to 120.
 */
function cleanOwnerName(raw: string): string {
  const cut = raw.split(/[(;]/, 1)[0].trim();
  return cut.slice(0, 120);
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    throw new Error('Usage: npx tsx scripts/seed-prospect-groups.ts <file.json> [<file2.json> ...]');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const rows: GroupRow[] = [];
  for (const file of files) {
    const path = resolve(file);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error(`${path} does not contain a JSON array`);
    rows.push(...(parsed as GroupRow[]));
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const name = (row.name ?? '').trim();
      const phone = row.phone?.trim() ? normalisePhone(row.phone) : '';
      const email = (row.email ?? '').trim();

      if (!name || (!phone && !email)) {
        skipped++;
        console.warn(`  ⚠ skipped (no phone AND no email): ${name || JSON.stringify(row).slice(0, 80)}`);
        continue;
      }

      const placeId =
        typeof row.place_id === 'string' && row.place_id.trim()
          ? row.place_id.trim()
          : `group:${slugify(name)}`;

      const ownerName = row.owner_name?.trim() ? cleanOwnerName(row.owner_name) : null;
      const locations =
        typeof row.locations === 'number' && Number.isFinite(row.locations)
          ? Math.trunc(row.locations)
          : null;
      const rating = row.rating !== undefined && row.rating !== null && `${row.rating}`.trim()
        ? `${row.rating}`.trim()
        : null;

      const result = await client.query(
        `INSERT INTO prospect_queue (
           place_id, restaurant_name, rating, review_count, phone, city,
           tier, locations, owner_name,
           status, next_action_at, updated_at
         ) VALUES ($1, $2, $3, NULL, $4, $5, 'group', $6, $7, 'identified', $8::timestamptz, now())
         ON CONFLICT (place_id) DO UPDATE SET
           restaurant_name = EXCLUDED.restaurant_name,
           rating = EXCLUDED.rating,
           review_count = EXCLUDED.review_count,
           phone = EXCLUDED.phone,
           city = EXCLUDED.city,
           tier = EXCLUDED.tier,
           locations = EXCLUDED.locations,
           owner_name = EXCLUDED.owner_name,
           updated_at = now()
           -- status intentionally preserved: never downgrade an existing
           -- row that is already replied/booked/won/lost. next_action_at
           -- intentionally preserved too.
         RETURNING (xmax = 0) AS inserted`,
        [
          placeId,
          name,
          rating,
          phone || null,
          row.city?.trim() || null,
          locations,
          ownerName,
          INERT_NEXT_ACTION_AT,
        ],
      );

      if (result.rows[0]?.inserted === true) inserted++;
      else updated++;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await pool.end();

  console.log(`\nInserted: ${inserted}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);
}

main().catch((error) => {
  console.error('✗ Seed failed:', error);
  process.exit(1);
});

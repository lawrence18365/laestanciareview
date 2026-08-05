#!/usr/bin/env npx tsx
/**
 * Seed outreach prospects from a JSON file.
 *
 * Usage:
 *   npx tsx scripts/seed-outreach.ts <path-to-prospects.json>
 *
 * Input JSON: array of {
 *   name, email, source_url, kind, place_id, phone, rating, city, confidence
 * }
 *
 * Upserts by unique email. Updates name/phone/etc on conflict but never
 * downgrades status or resets touches_sent.
 */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

type ProspectInput = {
  name?: string;
  email?: string;
  source_url?: string;
  kind?: 'leon' | 'group';
  place_id?: string;
  phone?: string;
  rating?: number | string;
  city?: string;
  confidence?: string;
};

const VALID_KINDS = new Set(['leon', 'group']);

function normalizeKind(kind: unknown): 'leon' | 'group' | null {
  if (typeof kind === 'string' && VALID_KINDS.has(kind)) return kind as 'leon' | 'group';
  return null;
}

function normalizeRating(rating: unknown): number | null {
  if (rating === null || rating === undefined) return null;
  const n = typeof rating === 'string' ? Number(rating) : Number(rating);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/seed-outreach.ts <path-to-prospects.json>');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const raw = readFileSync(resolve(filePath), 'utf-8');
  const inputs: unknown = JSON.parse(raw);
  if (!Array.isArray(inputs)) {
    console.error('Input file must be a JSON array');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const item of inputs as ProspectInput[]) {
      const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!email || !name) {
        skipped++;
        continue;
      }

      const kind = normalizeKind(item.kind) ?? 'leon';
      const rating = normalizeRating(item.rating);

      const result = await client.query(
        `INSERT INTO outreach_prospects (
           name, email, kind, place_id, phone, city, rating, source_url, confidence
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           phone = COALESCE(EXCLUDED.phone, outreach_prospects.phone),
           city = COALESCE(EXCLUDED.city, outreach_prospects.city),
           rating = COALESCE(EXCLUDED.rating, outreach_prospects.rating),
           source_url = COALESCE(EXCLUDED.source_url, outreach_prospects.source_url),
           confidence = COALESCE(EXCLUDED.confidence, outreach_prospects.confidence),
           kind = EXCLUDED.kind
           -- status and touches_sent intentionally preserved so re-seeding
           -- never downgrades an active prospect or resets its counter.
         RETURNING (xmax = 0) AS inserted`,
        [
          name,
          email,
          kind,
          item.place_id ?? null,
          item.phone ?? null,
          item.city ?? null,
          rating,
          item.source_url ?? null,
          item.confidence ?? null,
        ],
      );

      if (result.rows[0]?.inserted === true) {
        inserted++;
      } else {
        updated++;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Inserted: ${inserted}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);
}

main().catch((error) => {
  console.error('✗ Seed failed:', error);
  process.exit(1);
});

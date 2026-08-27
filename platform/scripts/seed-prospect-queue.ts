#!/usr/bin/env npx tsx
/**
 * Seed prospect_queue from the Mexico prospects mega CSV.
 *
 * Usage:
 *   ENV_FILE=.env.local npx tsx scripts/seed-prospect-queue.ts [path-to-csv]
 *
 * Default CSV: ../data/leads/mx-prospects-mega-2026-08-27.csv
 * Columns: city,zone,name,rating,review_count,phone,address,maps_url,pain_line_es
 * place_id is embedded in maps_url as ?q=place_id:<ID>.
 *
 * SAFETY: rows are seeded with status 'identified' AND
 * next_action_at = '2099-01-01T00:00:00Z' so the prospect-outreach cron
 * (which only touches rows where next_action_at IS NULL OR <= now) can
 * never auto-SMS them. On conflict we update only the descriptive fields
 * (name/rating/review_count/phone/city) — never status, timestamps, or
 * counters — and we backfill next_action_at=2099 ONLY when the existing
 * row has next_action_at IS NULL (retro-protecting old rows without
 * disturbing real schedules).
 *
 * zone/address/pain_line_es have no columns in prospect_queue, so they are
 * written to ../data/leads/prospect-pain-lines.json keyed by place_id.
 */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

const DEFAULT_CSV = resolve(__dirname, '../../data/leads/mx-prospects-mega-2026-08-27.csv');
const PAIN_LINES_OUT = resolve(__dirname, '../../data/leads/prospect-pain-lines.json');
const INERT_NEXT_ACTION_AT = '2099-01-01T00:00:00.000Z';

interface CsvRow {
  city: string;
  zone: string;
  name: string;
  rating: string;
  review_count: string;
  phone: string;
  address: string;
  maps_url: string;
  pain_line_es: string;
}

/** Minimal RFC-4180 CSV parser (handles quoted fields, commas, newlines, "" escapes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function extractPlaceId(mapsUrl: string): string | null {
  const m = /[?&]q=place_id:([^&\s]+)/.exec(mapsUrl);
  return m ? m[1] : null;
}

async function main() {
  const csvPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_CSV;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const rows = parseCsv(readFileSync(csvPath, 'utf-8'));
  const header = rows.shift();
  if (!header || header[0] !== 'city') {
    throw new Error(`Unexpected CSV header: ${header?.join(',')}`);
  }

  const records: CsvRow[] = rows.map((r) => ({
    city: r[0]?.trim() ?? '',
    zone: r[1]?.trim() ?? '',
    name: r[2]?.trim() ?? '',
    rating: r[3]?.trim() ?? '',
    review_count: r[4]?.trim() ?? '',
    phone: r[5]?.trim() ?? '',
    address: r[6]?.trim() ?? '',
    maps_url: r[7]?.trim() ?? '',
    pain_line_es: r[8]?.trim() ?? '',
  }));

  const painLines: Record<string, { zone: string; address: string; pain_line_es: string; maps_url: string }> = {};
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const rec of records) {
      const placeId = extractPlaceId(rec.maps_url);
      if (!placeId || !rec.name) {
        skipped++;
        console.warn(`  ⚠ skipped (no place_id): ${rec.name || rec.maps_url}`);
        continue;
      }

      const reviewCount = Number.parseInt(rec.review_count, 10);
      const result = await client.query(
        `INSERT INTO prospect_queue (
           place_id, restaurant_name, rating, review_count, phone, city,
           status, next_action_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'identified', $7::timestamptz)
         ON CONFLICT (place_id) DO UPDATE SET
           restaurant_name = EXCLUDED.restaurant_name,
           rating = EXCLUDED.rating,
           review_count = EXCLUDED.review_count,
           phone = EXCLUDED.phone,
           city = EXCLUDED.city,
           -- Retro-protect rows that never got a schedule from the cron,
           -- but never clobber a real next_action_at.
           next_action_at = CASE
             WHEN prospect_queue.next_action_at IS NULL THEN EXCLUDED.next_action_at
             ELSE prospect_queue.next_action_at
           END
           -- status, timestamps and counters intentionally preserved.
         RETURNING (xmax = 0) AS inserted`,
        [
          placeId,
          rec.name,
          rec.rating || null,
          Number.isFinite(reviewCount) ? reviewCount : null,
          rec.phone || null,
          rec.city || null,
          INERT_NEXT_ACTION_AT,
        ],
      );

      if (result.rows[0]?.inserted === true) inserted++;
      else updated++;

      painLines[placeId] = {
        zone: rec.zone,
        address: rec.address,
        pain_line_es: rec.pain_line_es,
        maps_url: rec.maps_url,
      };
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  writeFileSync(PAIN_LINES_OUT, JSON.stringify(painLines, null, 2));

  // ── Verification ──
  const total = await pool.query(`SELECT count(*)::int AS n FROM prospect_queue`);
  const inert = await pool.query(
    `SELECT count(*)::int AS n FROM prospect_queue WHERE next_action_at >= '2099-01-01T00:00:00Z'`,
  );
  const cronTargetable = await pool.query(
    `SELECT count(*)::int AS n FROM prospect_queue
      WHERE status IN ('pending','identified','queued','failed')
        AND (next_action_at IS NULL OR next_action_at <= now())`,
  );
  const samples = await pool.query(
    `SELECT place_id, restaurant_name, city, rating, review_count, phone, status, next_action_at
       FROM prospect_queue
      WHERE next_action_at >= '2099-01-01T00:00:00Z'
      ORDER BY review_count DESC NULLS LAST
      LIMIT 3`,
  );
  await pool.end();

  console.log(`\nInserted: ${inserted}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Pain lines JSON (${Object.keys(painLines).length} entries): ${PAIN_LINES_OUT}`);
  console.log(`\n── Verification ──`);
  console.log(`Total prospect_queue rows:            ${total.rows[0].n}`);
  console.log(`Rows with next_action_at >= 2099:     ${inert.rows[0].n}`);
  console.log(`Rows the cron can select right now:   ${cronTargetable.rows[0].n}`);
  console.log(`\nSamples:`);
  for (const s of samples.rows) {
    console.log(
      `  ${s.restaurant_name} | ${s.city} | ${s.rating}★ | ${s.review_count} reseñas | ${s.phone} | ${s.status} | next=${s.next_action_at}`,
    );
  }
}

main().catch((error) => {
  console.error('✗ Seed failed:', error);
  process.exit(1);
});

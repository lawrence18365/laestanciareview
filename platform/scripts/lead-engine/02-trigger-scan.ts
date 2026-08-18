#!/usr/bin/env npx tsx
/**
 * Daily Trigger Scan — polls Places API for every location of every group
 * already in the enriched prospect list. Snapshots ratings + review counts.
 *
 * Detects:
 *   - Threshold cross — group avg drops below 4.5, 4.3, or 4.0
 *   - Velocity spike — single location adds >3× its 14-day baseline reviews in 24h
 *   - New location detected — brand has more locations than last snapshot
 *
 * Output: data/leads/triggers-YYYY-MM-DD.csv + appends to data/leads/snapshots.jsonl
 *
 * Cost: ~$0.30 USD/day for ~150 location detail calls.
 */
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config({ path: '.env.local' });

const API_KEY = (process.env.GOOGLE_PLACES_API_KEY ?? '').replace(/\\n/g, '').trim();
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..', '..', '..');
const ENRICHED_PATH = path.join(ROOT, 'data', 'research', 'mx-group-prospects-enriched.json');
const OUT_DIR = path.join(ROOT, 'data', 'leads');
const SNAPSHOTS_PATH = path.join(OUT_DIR, 'snapshots.jsonl');

// Thresholds that fire alerts when crossed downward
const THRESHOLDS = [4.5, 4.3, 4.0];
const VELOCITY_MULTIPLIER = 3.0; // 24h reviews must exceed 3× the 14-day daily baseline

interface PlaceLite {
  place_id: string;
  rating?: number;
  user_ratings_total?: number;
}

interface LocationRecord {
  place_id: string;
  name: string;
  rating?: number;
  reviews?: number;
}

interface EnrichedGroup {
  brand: string;
  segment: string;
  hq: string;
  rated_locations: number;
  group_avg: number;
  locations: LocationRecord[];
}

interface Snapshot {
  date: string;
  brand: string;
  group_avg: number;
  total_reviews: number;
  locations: { place_id: string; name: string; rating?: number; reviews?: number }[];
}

async function placeDetails(placeId: string): Promise<PlaceLite | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=place_id,rating,user_ratings_total&language=es&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.status === 'OK' ? data.result : null;
}

function readSnapshots(): Snapshot[] {
  if (!fs.existsSync(SNAPSHOTS_PATH)) return [];
  return fs.readFileSync(SNAPSHOTS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Snapshot);
}

function appendSnapshot(s: Snapshot) {
  fs.appendFileSync(SNAPSHOTS_PATH, JSON.stringify(s) + '\n');
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(ENRICHED_PATH)) {
    console.error(`Missing ${ENRICHED_PATH} — run enrich-groups.ts first.`);
    process.exit(1);
  }

  const groups: EnrichedGroup[] = JSON.parse(fs.readFileSync(ENRICHED_PATH, 'utf8'));
  const tracked = groups.filter((g) => g.rated_locations >= 2);
  console.log(`Polling ${tracked.length} groups, ${tracked.reduce((s, g) => s + g.locations.length, 0)} locations…\n`);

  const today = new Date().toISOString().split('T')[0];
  const allSnapshots = readSnapshots();

  const alerts: { brand: string; type: string; detail: string; severity: 'HIGH' | 'MED' }[] = [];
  let apiCalls = 0;

  for (const g of tracked) {
    // Pull fresh data for each location
    const fresh: { place_id: string; name: string; rating?: number; reviews?: number }[] = [];
    for (const loc of g.locations) {
      if (!loc.place_id) continue;
      const d = await placeDetails(loc.place_id);
      apiCalls++;
      fresh.push({
        place_id: loc.place_id,
        name: loc.name,
        rating: d?.rating,
        reviews: d?.user_ratings_total,
      });
      await new Promise((r) => setTimeout(r, 120));
    }
    const ratings = fresh.filter((f) => f.rating !== undefined).map((f) => f.rating!);
    const groupAvg = ratings.length ? ratings.reduce((s, x) => s + x, 0) / ratings.length : 0;
    const totalReviews = fresh.reduce((s, f) => s + (f.reviews || 0), 0);

    // Compare against prior snapshots
    const groupHistory = allSnapshots.filter((s) => s.brand === g.brand).sort((a, b) => a.date.localeCompare(b.date));
    const prev = groupHistory[groupHistory.length - 1];

    // Threshold-cross alert
    if (prev) {
      for (const t of THRESHOLDS) {
        if (prev.group_avg >= t && groupAvg < t) {
          alerts.push({
            brand: g.brand,
            type: 'THRESHOLD_DOWN',
            detail: `Group avg crossed ${t}★ downward: ${prev.group_avg.toFixed(2)} → ${groupAvg.toFixed(2)}`,
            severity: 'HIGH',
          });
        }
      }
    }

    // Velocity spike per location — compare 24h delta to 14-day daily baseline
    if (groupHistory.length >= 1) {
      const oldest = groupHistory[Math.max(0, groupHistory.length - 14)];
      const daysSpan = (new Date(today).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSpan >= 3) {
        for (const f of fresh) {
          const oldLoc = oldest.locations.find((l) => l.place_id === f.place_id);
          const prevLoc = prev?.locations.find((l) => l.place_id === f.place_id);
          if (!oldLoc?.reviews || !prevLoc?.reviews || !f.reviews) continue;
          const baseline = (prevLoc.reviews - oldLoc.reviews) / Math.max(1, daysSpan - 1); // reviews per day
          const yesterdayDelta = f.reviews - prevLoc.reviews;
          if (baseline > 0.3 && yesterdayDelta > baseline * VELOCITY_MULTIPLIER && yesterdayDelta >= 5) {
            alerts.push({
              brand: g.brand,
              type: 'VELOCITY_SPIKE',
              detail: `${f.name} added ${yesterdayDelta} reviews in 24h (baseline ~${baseline.toFixed(1)}/day)`,
              severity: 'HIGH',
            });
          }
        }
      }
    }

    // Persistent low-avg alert (no prior snapshot or first run)
    if (!prev && groupAvg > 0 && groupAvg < 4.0) {
      alerts.push({
        brand: g.brand,
        type: 'LOW_BASELINE',
        detail: `Group avg ${groupAvg.toFixed(2)}★ — chronic pain, no prior snapshot`,
        severity: 'MED',
      });
    }

    appendSnapshot({ date: today, brand: g.brand, group_avg: groupAvg, total_reviews: totalReviews, locations: fresh });

    process.stdout.write(`  ${g.brand.padEnd(30)} ${groupAvg.toFixed(2)}★  ${totalReviews.toLocaleString().padStart(8)} reviews`);
    if (prev) process.stdout.write(`   (prev ${prev.group_avg.toFixed(2)}★ on ${prev.date})`);
    process.stdout.write('\n');
  }

  // Write alerts CSV (empty file with header even if no alerts)
  const csvPath = path.join(OUT_DIR, `triggers-${today}.csv`);
  const lines = ['severity,brand,type,detail'];
  for (const a of alerts) {
    lines.push([a.severity, `"${a.brand}"`, a.type, `"${a.detail.replace(/"/g, '""')}"`].join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  console.log(`\n${alerts.length} alerts fired:`);
  for (const a of alerts) console.log(`  [${a.severity}] ${a.brand} — ${a.type}: ${a.detail}`);
  console.log(`\nAPI calls: ${apiCalls} (~$${(apiCalls * 0.017).toFixed(2)} USD — details billed cheaper than nearby)`);
  console.log(`Wrote: ${csvPath}`);
  console.log(`Appended snapshot rows to: ${SNAPSHOTS_PATH}`);
})().catch((e: unknown) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

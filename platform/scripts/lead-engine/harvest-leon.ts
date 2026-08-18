#!/usr/bin/env npx tsx
/**
 * Harvest León single-restaurant prospects for the WhatsApp audit blitz.
 *
 * chain-discovery.ts finds multi-location GROUPS; this finds single León
 * restaurants in the sweet spot (3.5-4.4★, 50+ reviews) and fetches a phone
 * number for each (Nearby Search has no phone, so one Place Details call per
 * candidate). Dedupes against existing customers + the seed list + whatever is
 * already in leon-prospects.json. Output feeds whatsapp-blitz.ts directly.
 *
 * Output: data/leads/leon-prospects.json  (merged, deduped by placeId)
 *
 * Usage:
 *   npx tsx scripts/lead-engine/harvest-leon.ts            # default cap 40 detail lookups
 *   npx tsx scripts/lead-engine/harvest-leon.ts --max=80   # widen the net
 */
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config({ path: '.env.local' });

const API_KEY = (process.env.GOOGLE_PLACES_API_KEY ?? '').replace(/\\n/g, '').trim();
if (!API_KEY) { console.error('Missing GOOGLE_PLACES_API_KEY'); process.exit(1); }

const MAX_DETAILS = (() => {
  const a = process.argv.find((x) => x.startsWith('--max='));
  return a ? parseInt(a.split('=')[1], 10) : 40;
})();

const OUT = path.join(__dirname, '..', '..', '..', 'data', 'leads', 'leon-prospects.json');

// León dining zones — overlapping 3.5km circles cover the city.
const ANCHORS = [
  { zone: 'Centro',            lat: 21.1230, lng: -101.6800 },
  { zone: 'Campestre/Country', lat: 21.1170, lng: -101.6620 },
  { zone: 'López Mateos',      lat: 21.1010, lng: -101.6500 },
  { zone: 'Las Trojes',        lat: 21.0830, lng: -101.6080 },
  { zone: 'Malecón/Forum',     lat: 21.1300, lng: -101.6700 },
];
const RADIUS = 3500;
const RATING_MIN = 3.5, RATING_MAX = 4.4, MIN_REVIEWS = 50;

const EXCLUDED = [
  'estancia', 'harbors', 'la silla', 'steak company',
  'mcdonald', 'burger king', 'kfc', 'domino', 'subway', 'pizza hut', 'starbucks',
  'wingstop', 'taco bell', 'little caesars', 'panda express', 'krispy kreme',
  'oxxo', '7-eleven', '7 eleven', 'walmart', 'sams', 'costco', 'sanborns', 'vips',
  'carl', 'chili', 'applebee', 'italianni', 'toks', 'el portón',
  // national franchises (corporate decides) + wrong buyer (hotel/casino/store/catering)
  'ihop', 'italian coffee', 'bisquets obregón', 'bisquets obregon', 'pollo feliz',
  'sushitai', 'p.f. chang', 'sirloin', 'hotel', 'liverpool', 'casino', 'caliente',
  'banquetes', 'salón', 'salon de', 'palacio de hierro', 'cinépolis', 'cinemex',
];

interface Place {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
}

async function nearby(lat: number, lng: number, token?: string) {
  const p = new URLSearchParams({ location: `${lat},${lng}`, radius: String(RADIUS), type: 'restaurant', language: 'es', key: API_KEY });
  if (token) p.set('pagetoken', token);
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${p}`);
  return res.json() as Promise<{ results?: Place[]; next_page_token?: string }>;
}

async function sweep(lat: number, lng: number): Promise<Place[]> {
  const seen = new Map<string, Place>();
  let token: string | undefined;
  for (let i = 0; i < 3; i++) {
    const data = await nearby(lat, lng, token);
    for (const r of data.results || []) {
      if (r.place_id && r.business_status !== 'CLOSED_PERMANENTLY') seen.set(r.place_id, r);
    }
    token = data.next_page_token;
    if (!token) break;
    await new Promise((r) => setTimeout(r, 2100));
  }
  return [...seen.values()];
}

async function getPhone(placeId: string): Promise<string | null> {
  const p = new URLSearchParams({ place_id: placeId, fields: 'international_phone_number,formatted_phone_number', key: API_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${p}`);
  const data = await res.json() as { result?: { international_phone_number?: string; formatted_phone_number?: string } };
  const raw = data.result?.international_phone_number || data.result?.formatted_phone_number;
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits.startsWith('52')) digits = '52' + digits; // MX country code
  return digits.length >= 12 ? digits : null;
}

const isExcluded = (n: string) => EXCLUDED.some((b) => n.toLowerCase().includes(b));

// Brand key: strip accents, location suffixes ("Suc. X", "- Plaza Y", parentheses)
// so multi-location brands collapse to one outreach target.
function brandKey(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*[-,(]\s*(suc\.?|sucursal)?.*$/i, '')
    .replace(/\s+(suc\.?|sucursal)\s+.*$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Dedupe a prospect list: one entry per phone AND one per brand (keep first).
function dedupe<T extends { name: string; phone: string }>(list: T[]): T[] {
  const seenPhone = new Set<string>(), seenBrand = new Set<string>(), out: T[] = [];
  for (const p of list) {
    const bk = brandKey(p.name);
    if (seenPhone.has(p.phone) || seenBrand.has(bk)) continue;
    seenPhone.add(p.phone); seenBrand.add(bk); out.push(p);
  }
  return out;
}

(async () => {
  // Load existing prospects (seed + prior harvests) to dedupe & merge
  const existing: { name: string; placeId: string; phone: string }[] = fs.existsSync(OUT)
    ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const haveIds = new Set(existing.map((p) => p.placeId));

  console.log(`\n  Harvesting León — ${ANCHORS.length} zones × 3 pages.\n`);
  const all = new Map<string, Place>();
  for (const a of ANCHORS) {
    const places = await sweep(a.lat, a.lng);
    for (const p of places) all.set(p.place_id, p);
    console.log(`  ${a.zone.padEnd(18)} ${places.length} restaurants`);
  }

  const candidates = [...all.values()]
    .filter((p) => p.rating && p.user_ratings_total
      && p.rating >= RATING_MIN && p.rating <= RATING_MAX
      && p.user_ratings_total >= MIN_REVIEWS
      && !isExcluded(p.name)
      && !haveIds.has(p.place_id))
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0))
    .slice(0, MAX_DETAILS);

  console.log(`\n  ${all.size} seen, ${candidates.length} new sweet-spot candidates. Fetching phones…\n`);

  const fresh: { name: string; placeId: string; phone: string; rating: number; reviews: number }[] = [];
  for (const c of candidates) {
    const phone = await getPhone(c.place_id);
    if (phone) {
      fresh.push({ name: c.name, placeId: c.place_id, phone, rating: c.rating!, reviews: c.user_ratings_total! });
      console.log(`  ✓ ${c.name.padEnd(38)} ${c.rating}★ ${c.user_ratings_total} rev  ${phone}`);
    } else {
      console.log(`  ✗ ${c.name.padEnd(38)} no phone`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const merged = dedupe([...existing, ...fresh]);
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2));

  console.log(`\n  +${fresh.length} found this run. After phone/brand dedupe, total: ${merged.length}.`);
  console.log(`  Wrote: ${OUT}`);
  console.log(`  Next:  npx tsx scripts/lead-engine/whatsapp-blitz.ts\n`);
})().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1); });

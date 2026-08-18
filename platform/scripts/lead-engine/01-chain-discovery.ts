#!/usr/bin/env npx tsx
/**
 * Daily Chain Discovery — sweeps Places Nearby Search across target MX cities
 * for sweet-spot restaurants (3.5–4.4★, 50+ reviews), groups by exact-name
 * match, and surfaces brands that appear 2+ times = candidate multi-location
 * groups not yet on the prospect list.
 *
 * Dedupes against:
 *   - data/research/mx-group-prospects-enriched.json (groups already tracked)
 *   - data/leads/chain-discovery-known-brands.json (running ignore list)
 *   - hardcoded EXCLUDED_BRANDS (existing customers + obvious QSR)
 *
 * Output: data/leads/chain-discovery-YYYY-MM-DD.csv
 * Cost: ~$0.25 USD/day across 7 cities × 4 anchor points × 3 pages
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
const OUT_DIR = path.join(ROOT, 'data', 'leads');
const KNOWN_PATH = path.join(OUT_DIR, 'chain-discovery-known-brands.json');
const ENRICHED_PATH = path.join(ROOT, 'data', 'research', 'mx-group-prospects-enriched.json');

// Existing customers + QSR chains to skip
const EXCLUDED_BRANDS = [
  'estancia', 'harbors', 'la silla', 'steak company', 'real', 'regio',
  'mcdonald', 'burger king', 'kfc', 'domino', 'subway', 'pizza hut', 'starbucks',
  'wingstop', 'taco bell', 'little caesars', 'panda express', 'krispy kreme',
  'oxxo', '7-eleven', '7 eleven', 'walmart', 'sams club', 'costco', 'sanborns',
];

// Anchor points: city center + 3 affluent zones per major market.
// Restaurant Density Map: CDMX > MTY > GDL > León > Cancún > QRO > Mérida.
const ANCHORS = [
  // CDMX — densest, highest priority
  { city: 'CDMX-Polanco',         lat: 19.4338, lng: -99.1925 },
  { city: 'CDMX-Roma-Cond',       lat: 19.4180, lng: -99.1620 },
  { city: 'CDMX-Santa-Fe',        lat: 19.3590, lng: -99.2580 },
  { city: 'CDMX-Coyoacan',        lat: 19.3450, lng: -99.1620 },
  // MTY — high purchasing power
  { city: 'MTY-San-Pedro',        lat: 25.6515, lng: -100.4030 },
  { city: 'MTY-Centro',           lat: 25.6720, lng: -100.3100 },
  // GDL
  { city: 'GDL-Providencia',      lat: 20.7050, lng: -103.3800 },
  { city: 'GDL-Andares',          lat: 20.7090, lng: -103.4200 },
  // León (current customer base)
  { city: 'LEON-Centro',          lat: 21.1230, lng: -101.6800 },
  // Querétaro — greenfield
  { city: 'QRO-Centro',           lat: 20.5880, lng: -100.3920 },
  // Cancún — resort groups
  { city: 'CUN-Zona-Hotelera',    lat: 21.1200, lng: -86.7700 },
];
const RADIUS = 3500;

const RATING_MIN = 3.5;
const RATING_MAX = 4.4;
const MIN_REVIEWS = 50;

interface Place {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  vicinity?: string;
  business_status?: string;
  geometry?: { location: { lat: number; lng: number } };
}

async function nearby(lat: number, lng: number, pageToken?: string): Promise<{ results: Place[]; next_page_token?: string }> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: RADIUS.toString(),
    type: 'restaurant',
    language: 'es',
    key: API_KEY,
  });
  if (pageToken) params.set('pagetoken', pageToken);
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`);
  return res.json();
}

async function sweepAnchor(anchor: typeof ANCHORS[number]): Promise<Place[]> {
  const seen = new Map<string, Place>();
  let pageToken: string | undefined;
  for (let p = 0; p < 3; p++) {
    const data = await nearby(anchor.lat, anchor.lng, pageToken);
    for (const r of data.results || []) {
      if (r.place_id && !seen.has(r.place_id) && r.business_status !== 'CLOSED_PERMANENTLY') {
        seen.set(r.place_id, r);
      }
    }
    pageToken = data.next_page_token;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 2100));
  }
  return [...seen.values()];
}

function nameKey(name: string): string {
  // Normalize: lowercase, strip diacritics, remove location suffixes like "Polanco" / "(Reforma)"
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+(polanco|roma|condesa|santa\s?fe|coyoacan|interlomas|del\s?valle|reforma|insurgentes|masaryk|centro|norte|sur|oriente|poniente|andares|providencia|chapalita|punto\s?sao\s?paulo|antara|altavista|cuauhtemoc|miguel\s?hidalgo|napoles|escandon|granada|polanquito|tlalpan|narvarte|portales|americana|moderna|chapultepec|reforma\s?\d+|plaza\s?[a-z]+)\b.*$/i, '')
    .replace(/\s*\(.+\)\s*$/, '')
    .replace(/\s+(express|to\s?go|drive[\s-]?thru|delivery|kiosco)\b.*$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExcluded(name: string): boolean {
  const n = name.toLowerCase();
  return EXCLUDED_BRANDS.some((b) => n.includes(b));
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load already-tracked groups so we skip them
  const knownTracked = new Set<string>();
  if (fs.existsSync(ENRICHED_PATH)) {
    const enriched = JSON.parse(fs.readFileSync(ENRICHED_PATH, 'utf8'));
    for (const g of enriched) knownTracked.add(nameKey(g.brand));
  }
  const knownDiscovered: { brand: string; firstSeen: string }[] = fs.existsSync(KNOWN_PATH)
    ? JSON.parse(fs.readFileSync(KNOWN_PATH, 'utf8'))
    : [];
  for (const k of knownDiscovered) knownTracked.add(nameKey(k.brand));

  console.log(`Sweep starting — ${ANCHORS.length} anchors × 3 pages.\n`);
  const allPlaces: Place[] = [];
  let apiCalls = 0;

  for (const a of ANCHORS) {
    console.log(`  ${a.city.padEnd(20)} …`);
    const places = await sweepAnchor(a);
    apiCalls += 3;
    for (const p of places) {
      allPlaces.push(p);
    }
    console.log(`    ${places.length} restaurants`);
  }

  // Filter to sweet-spot
  const sweetSpot = allPlaces.filter((p) =>
    p.rating && p.user_ratings_total &&
    p.rating >= RATING_MIN && p.rating <= RATING_MAX &&
    p.user_ratings_total >= MIN_REVIEWS &&
    !isExcluded(p.name)
  );

  // Group by name key
  const byBrand = new Map<string, Place[]>();
  for (const p of sweetSpot) {
    const k = nameKey(p.name);
    if (!byBrand.has(k)) byBrand.set(k, []);
    byBrand.get(k)!.push(p);
  }

  // Candidates = brands with 2+ locations in the sweep that are NOT already tracked
  const candidates: { brand: string; key: string; locations: Place[]; avgRating: number; totalReviews: number }[] = [];
  for (const [key, places] of byBrand.entries()) {
    if (places.length < 2) continue;
    if (knownTracked.has(key)) continue;
    const ratings = places.map((p) => p.rating!);
    const avg = ratings.reduce((s, x) => s + x, 0) / ratings.length;
    const totalReviews = places.reduce((s, p) => s + (p.user_ratings_total || 0), 0);
    candidates.push({
      brand: places[0].name,
      key,
      locations: places,
      avgRating: avg,
      totalReviews,
    });
  }
  candidates.sort((a, b) => b.totalReviews - a.totalReviews);

  // Write CSV
  const stamp = new Date().toISOString().split('T')[0];
  const csvPath = path.join(OUT_DIR, `chain-discovery-${stamp}.csv`);
  const lines = ['brand,locations_found,avg_rating,total_reviews,sample_address_1,sample_address_2,sample_address_3,first_place_id'];
  for (const c of candidates) {
    const addrs = c.locations.slice(0, 3).map((l) => (l.vicinity || '').replace(/,/g, ';'));
    while (addrs.length < 3) addrs.push('');
    lines.push([
      `"${c.brand.replace(/"/g, '""')}"`,
      c.locations.length,
      c.avgRating.toFixed(2),
      c.totalReviews,
      `"${addrs[0]}"`, `"${addrs[1]}"`, `"${addrs[2]}"`,
      c.locations[0].place_id,
    ].join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  // Update running known-brands list with today's new finds (so they're not re-flagged tomorrow)
  const updatedKnown = [...knownDiscovered];
  for (const c of candidates) {
    updatedKnown.push({ brand: c.brand, firstSeen: stamp });
  }
  fs.writeFileSync(KNOWN_PATH, JSON.stringify(updatedKnown, null, 2));

  console.log(`\nSweep complete: ${allPlaces.length} restaurants seen, ${sweetSpot.length} in sweet-spot, ${candidates.length} new candidate brands.`);
  console.log(`Top 15 by review volume:`);
  candidates.slice(0, 15).forEach((c, i) =>
    console.log(`  ${(i + 1).toString().padStart(2)}. ${c.brand.padEnd(40)} ${c.locations.length} loc  ${c.avgRating.toFixed(2)}★  ${c.totalReviews.toLocaleString()} reviews`)
  );
  console.log(`\nAPI calls: ${apiCalls} (~$${(apiCalls * 0.032).toFixed(2)} USD)`);
  console.log(`Wrote: ${csvPath}`);
})().catch((e: unknown) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});

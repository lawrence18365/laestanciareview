#!/usr/bin/env npx tsx
/**
 * RateTap Group-Prospect Enrichment
 *
 * Takes a list of named Mexican restaurant groups (the "knock-tomorrow" list from
 * the market map) and enriches each location via Google Places API:
 *   - Text Search to find every location of each group in Mexico
 *   - Place Details for rating, review count, address, phone, website, hours
 *   - Aggregates per-group: # locations, group avg rating, weakest location (the
 *     outreach hook), strongest, review count
 *
 * Output: data/research/mx-group-prospects-enriched.csv
 *
 * Usage:  npx tsx scripts/enrich-groups.ts
 * Cost:   ~$0.20–0.80 USD per run (25 text searches + ~150 detail calls)
 */
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config({ path: '.env.local' });

const API_KEY = (process.env.GOOGLE_PLACES_API_KEY ?? '').replace(/\\n/g, '').trim();
if (!API_KEY) {
  console.error('❌ Missing GOOGLE_PLACES_API_KEY in .env.local');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'research');
const OUT_CSV = path.join(OUT_DIR, 'mx-group-prospects-enriched.csv');
const OUT_JSON = path.join(OUT_DIR, 'mx-group-prospects-enriched.json');

// Existing RateTap customer brand prefixes — DO NOT prospect these
const EXISTING_CUSTOMERS = ['estancia', 'harbors', 'la silla', 'la-silla', 'steak company', 'steakcompany', 'real', 'regio'];

/**
 * Named Mexican restaurant groups (knock-tomorrow shortlist + Tier-1 ICP).
 * `query` is the Places Text Search phrase. `expected` is the rough # locations
 * we know from the market map — used to flag obvious under-counting.
 * `segment` lets us filter to NFC-fit segments later.
 */
const GROUPS: { brand: string; query: string; expected: number; segment: string; hq: string }[] = [
  // Steakhouses — best fit
  { brand: 'Sonora Grill',          query: 'Sonora Grill restaurante México',       expected: 22, segment: 'steakhouse', hq: 'CDMX' },
  { brand: 'La Mansión',            query: 'La Mansión steakhouse México',           expected: 20, segment: 'steakhouse', hq: 'CDMX' },
  { brand: 'Grupo Carolo',          query: 'Carolo restaurante México',              expected: 6,  segment: 'fine-casual', hq: 'CDMX' },
  { brand: 'Grupo Pangea',          query: 'Pangea restaurante Monterrey',           expected: 6,  segment: 'fine', hq: 'MTY' },
  { brand: 'Cuerno',                query: 'Cuerno restaurante México',              expected: 5,  segment: 'steakhouse', hq: 'CDMX' },
  { brand: 'Grupo Barra',           query: 'La Buena Barra Doble B restaurante',     expected: 7,  segment: 'steakhouse', hq: 'MTY' },
  { brand: 'Karne Garibaldi',       query: 'Karne Garibaldi Guadalajara',            expected: 5,  segment: 'mx-traditional', hq: 'GDL' },
  // Seafood casual — best fit
  { brand: 'Los Arcos',             query: 'Mariscos Los Arcos México',              expected: 16, segment: 'seafood', hq: 'Culiacán' },
  { brand: 'Grupo Costeño',         query: 'Restaurante Costeño México',             expected: 27, segment: 'seafood', hq: 'Torreón' },
  { brand: 'Lorenzillo\'s',         query: 'Lorenzillos restaurante México',         expected: 4,  segment: 'seafood-fine', hq: 'Cancún' },
  { brand: 'La Docena',             query: 'La Docena Oyster Bar',                   expected: 4,  segment: 'seafood', hq: 'GDL' },
  { brand: 'Contramar',             query: 'Contramar Entremar restaurante CDMX',    expected: 2,  segment: 'seafood-fine', hq: 'CDMX' },
  // Mexican traditional FS
  { brand: 'El Bajío',              query: 'Restaurante El Bajío Carmen Titita',     expected: 19, segment: 'mx-traditional', hq: 'CDMX' },
  { brand: 'La Casa de Toño',       query: 'La Casa de Toño pozole',                 expected: 60, segment: 'mx-casual', hq: 'CDMX' },
  { brand: 'El Cardenal',           query: 'El Cardenal restaurante CDMX',           expected: 3,  segment: 'mx-fine', hq: 'CDMX' },
  { brand: 'Casa Merlos',           query: 'Casa Merlos Puebla CDMX restaurante',    expected: 2,  segment: 'mx-fine', hq: 'CDMX' },
  // Fine dining
  { brand: 'Grupo Casamata',        query: 'Pujol Eno Molino restaurante Olvera',    expected: 5,  segment: 'fine', hq: 'CDMX' },
  { brand: 'Grupo Rosetta',         query: 'Rosetta Lardo Café Nin Elena Reygadas',  expected: 5,  segment: 'fine', hq: 'CDMX' },
  { brand: 'Estoril',               query: 'Estoril Bistro Priceless CDMX',          expected: 4,  segment: 'fine', hq: 'CDMX' },
  { brand: 'Grupo Hunan',           query: 'Hunan Nobu Trastevere Cuaik restaurante', expected: 14, segment: 'fine', hq: 'CDMX' },
  // Upscale casual / themed
  { brand: 'Bistro 83',             query: 'Bistro 83 San Ángel Roma',               expected: 3,  segment: 'mediterranean', hq: 'CDMX' },
  { brand: 'Donatella',             query: 'Donatella Pablo Moctezuma restaurante',  expected: 3,  segment: 'upscale-casual', hq: 'CDMX' },
  { brand: 'Cinbersol',             query: 'Cantina La No 20 Cinbersol',             expected: 6,  segment: 'cantina', hq: 'CDMX' },
  // Mérida / regional
  { brand: 'La Chaya Maya',         query: 'La Chaya Maya Mérida Yucatán',           expected: 3,  segment: 'mx-traditional', hq: 'Mérida' },
  { brand: 'Trotter\'s',            query: 'Trotters Steakhouse Mérida',             expected: 3,  segment: 'steakhouse', hq: 'Mérida' },
  // Wings — light coverage
  { brand: 'Wings Army',            query: 'Wings Army México',                       expected: 50, segment: 'sports-bar', hq: 'León' },
  // Baja
  { brand: 'Plascencia (Misión 19)', query: 'Misión 19 Bracero Plascencia Tijuana',  expected: 6,  segment: 'fine', hq: 'Tijuana' },
];

interface Place {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_address?: string;
  business_status?: string;
  types?: string[];
  geometry?: { location: { lat: number; lng: number } };
}

interface PlaceDetail extends Place {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string;
  price_level?: number;
}

async function textSearch(query: string, pageToken?: string): Promise<{ results: Place[]; next_page_token?: string }> {
  const params = new URLSearchParams({ query, language: 'es', region: 'mx', key: API_KEY });
  if (pageToken) params.set('pagetoken', pageToken);
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
  return res.json();
}

async function placeDetails(placeId: string): Promise<PlaceDetail | null> {
  const fields = 'place_id,name,rating,user_ratings_total,formatted_address,formatted_phone_number,international_phone_number,website,url,price_level,business_status,types';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&language=es&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.status === 'OK' ? data.result : null;
}

async function searchAllPages(query: string, maxPages = 3): Promise<Place[]> {
  const seen = new Map<string, Place>();
  let pageToken: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const data = await textSearch(query, pageToken);
    for (const r of data.results || []) {
      if (r.place_id && !seen.has(r.place_id) && r.business_status !== 'CLOSED_PERMANENTLY') {
        seen.set(r.place_id, r);
      }
    }
    pageToken = data.next_page_token;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 2200));
  }
  return [...seen.values()];
}

function isLikelyMatch(name: string, brand: string): boolean {
  const n = name.toLowerCase();
  const b = brand.toLowerCase();
  // Filter aggressively to brand name — Places fuzzy-matches generously
  const stems = b.split(/\s+/).filter((s) => s.length > 3);
  // require at least one core stem to appear
  return stems.some((s) => n.includes(s));
}

function isExistingCustomer(name: string): boolean {
  const n = name.toLowerCase();
  return EXISTING_CUSTOMERS.some((c) => n.includes(c));
}

async function enrichOne(group: typeof GROUPS[number]) {
  console.log(`\n→ ${group.brand} (${group.segment}, expected ~${group.expected})`);
  const raw = await searchAllPages(group.query);
  const filtered = raw.filter((p) => isLikelyMatch(p.name, group.brand) && !isExistingCustomer(p.name));
  console.log(`   ${raw.length} raw hits → ${filtered.length} brand matches`);

  // Pull full details for each
  const detailed: PlaceDetail[] = [];
  for (const p of filtered) {
    const d = await placeDetails(p.place_id);
    if (d) detailed.push(d);
    await new Promise((r) => setTimeout(r, 120));
  }

  // Aggregate
  const rated = detailed.filter((d) => d.rating && d.user_ratings_total);
  const ratings = rated.map((d) => d.rating!);
  const groupAvg = ratings.length ? ratings.reduce((s, x) => s + x, 0) / ratings.length : 0;
  const sorted = [...rated].sort((a, b) => (a.rating || 0) - (b.rating || 0));
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  const totalReviews = rated.reduce((s, d) => s + (d.user_ratings_total || 0), 0);

  return {
    ...group,
    found_locations: filtered.length,
    rated_locations: rated.length,
    group_avg: groupAvg,
    total_reviews: totalReviews,
    weakest: weakest ? { name: weakest.name, rating: weakest.rating, reviews: weakest.user_ratings_total, place_id: weakest.place_id, address: weakest.formatted_address } : null,
    strongest: strongest ? { name: strongest.name, rating: strongest.rating, reviews: strongest.user_ratings_total } : null,
    locations: detailed.map((d) => ({
      place_id: d.place_id,
      name: d.name,
      rating: d.rating,
      reviews: d.user_ratings_total,
      address: d.formatted_address,
      phone: d.formatted_phone_number,
      website: d.website,
      maps_url: d.url,
      price_level: d.price_level,
    })),
  };
}

function buildHook(g: Awaited<ReturnType<typeof enrichOne>>): string {
  if (!g.weakest || !g.strongest || g.rated_locations < 2) return '';
  const gap = (g.strongest.rating! - g.weakest.rating!).toFixed(1);
  if (parseFloat(gap) < 0.2) return `Su grupo promedia ${g.group_avg.toFixed(1)}★ con consistencia entre sucursales — la oportunidad es proteger eso antes de que baje.`;
  const wname = g.weakest.name.replace(/\s+\(.+\)$/, '');
  const sname = g.strongest.name.replace(/\s+\(.+\)$/, '');
  return `${sname} está en ${g.strongest.rating}★, pero ${wname} arrastra al grupo a ${g.group_avg.toFixed(2)}★ (${gap} estrellas debajo). Esa brecha es la que tapamos.`;
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Enriching ${GROUPS.length} groups via Places API…`);
  const enriched: Array<Awaited<ReturnType<typeof enrichOne>>> = [];
  for (const g of GROUPS) {
    try {
      enriched.push(await enrichOne(g));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`   ERROR on ${g.brand}: ${msg}`);
    }
  }

  // Sort by group_avg ascending = lowest-rated groups first (biggest opportunity)
  // But only among groups with ≥3 rated locations (otherwise data is noise)
  const ranked = enriched.filter((g) => g.rated_locations >= 2).sort((a, b) => a.group_avg - b.group_avg);

  // ─── CSV output ───
  const csvLines = [
    'brand,segment,hq,expected_locations,found_locations,rated_locations,group_avg_rating,total_reviews,weakest_location,weakest_rating,weakest_reviews,strongest_location,strongest_rating,rating_gap,hook_es,audit_link_weakest',
  ];
  const BASE = 'https://app.ratetapmx.com';
  for (const g of ranked) {
    const hook = buildHook(g).replace(/"/g, '""');
    const gap = g.weakest && g.strongest ? (g.strongest.rating! - g.weakest.rating!).toFixed(2) : '';
    const auditLink = g.weakest?.place_id ? `${BASE}/audit/${g.weakest.place_id}` : '';
    csvLines.push([
      g.brand, g.segment, g.hq, g.expected, g.found_locations, g.rated_locations,
      g.group_avg.toFixed(2), g.total_reviews,
      g.weakest ? `"${g.weakest.name.replace(/"/g, '""')}"` : '', g.weakest?.rating ?? '', g.weakest?.reviews ?? '',
      g.strongest ? `"${g.strongest.name.replace(/"/g, '""')}"` : '', g.strongest?.rating ?? '',
      gap, `"${hook}"`, auditLink,
    ].join(','));
  }
  fs.writeFileSync(OUT_CSV, csvLines.join('\n'));
  fs.writeFileSync(OUT_JSON, JSON.stringify(enriched, null, 2));

  // ─── Console summary, ranked by opportunity ───
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('RANKED OPPORTUNITY (lowest group avg = highest pain = best opener)');
  console.log('═══════════════════════════════════════════════════════════════════');
  for (const g of ranked) {
    const gap = g.weakest && g.strongest ? (g.strongest.rating! - g.weakest.rating!).toFixed(1) : '0';
    console.log(`\n${g.brand}  (${g.segment}, ${g.hq})  ·  ${g.rated_locations} loc  ·  ${g.group_avg.toFixed(2)}★ avg  ·  ${g.total_reviews.toLocaleString()} reviews  ·  gap ${gap}★`);
    console.log(`  Weakest:   ${g.weakest?.name} — ${g.weakest?.rating}★ (${g.weakest?.reviews} reseñas)`);
    console.log(`  Strongest: ${g.strongest?.name} — ${g.strongest?.rating}★ (${g.strongest?.reviews} reseñas)`);
    console.log(`  Hook:      ${buildHook(g)}`);
    if (g.weakest?.place_id) console.log(`  Audit:     ${BASE}/audit/${g.weakest.place_id}`);
  }
  console.log(`\nWrote ${ranked.length} ranked groups → ${OUT_CSV}`);
  console.log(`Full JSON → ${OUT_JSON}`);
})();

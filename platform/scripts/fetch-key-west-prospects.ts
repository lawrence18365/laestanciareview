/**
 * Pull Key West restaurant prospects from Google Places API.
 * Targets 3.5–4.3★ ratings — enough reviews to care, enough pain to need help.
 *
 * Usage: npx tsx scripts/fetch-key-west-prospects.ts
 * Output: scripts/key-west-prospects.json
 */
import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local', override: false });

import * as fs from 'fs';
import * as path from 'path';

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!.replace(/\\n/g, '').trim();
const BASE = 'https://maps.googleapis.com/maps/api';

interface PlaceResult {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_phone_number?: string;
  international_phone_number?: string;
  vicinity?: string;
  website?: string;
}

async function textSearch(query: string, pagetoken?: string): Promise<{ results: PlaceResult[]; next_page_token?: string }> {
  const params = new URLSearchParams({
    query,
    type: 'restaurant',
    key: API_KEY,
    ...(pagetoken ? { pagetoken } : {}),
  });
  const res = await fetch(`${BASE}/place/textsearch/json?${params}`);
  const data = await res.json() as { results: PlaceResult[]; next_page_token?: string; status: string };
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('Text search status:', data.status);
  }
  return data;
}

async function getDetails(placeId: string): Promise<PlaceResult | null> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,rating,user_ratings_total,formatted_phone_number,international_phone_number,website,vicinity',
    key: API_KEY,
  });
  const res = await fetch(`${BASE}/place/details/json?${params}`);
  const data = await res.json() as { result?: PlaceResult; status: string };
  if (data.status !== 'OK') return null;
  return data.result ?? null;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Searching for Key West restaurants...\n');

  const allPlaces: PlaceResult[] = [];
  const seen = new Set<string>();

  // Multiple queries to maximize coverage — KW is a small city
  const queries = [
    'restaurants in Key West Florida',
    'bars and restaurants Key West FL',
    'seafood restaurants Key West Florida',
  ];

  for (const query of queries) {
    console.log(`  Query: "${query}"`);
    let page = await textSearch(query);
    for (const r of page.results) {
      if (!seen.has(r.place_id)) {
        seen.add(r.place_id);
        allPlaces.push(r);
      }
    }

    // Google requires a 2s delay before using next_page_token
    if (page.next_page_token) {
      await sleep(2500);
      page = await textSearch(query, page.next_page_token);
      for (const r of page.results) {
        if (!seen.has(r.place_id)) {
          seen.add(r.place_id);
          allPlaces.push(r);
        }
      }
    }
  }

  console.log(`\nTotal unique places found: ${allPlaces.length}`);

  // Filter to the sweet spot: 3.5–4.3★, 50+ reviews (enough to care)
  const candidates = allPlaces.filter(
    (p) => p.rating != null && p.rating >= 3.5 && p.rating <= 4.3 && (p.user_ratings_total ?? 0) >= 50,
  );

  console.log(`After rating filter (3.5–4.3★, 50+ reviews): ${candidates.length}`);

  // Sort by review count desc — more reviews = more established = more pain
  candidates.sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0));

  // Fetch phone details for top 60 (we'll trim to 50 after)
  const enriched: Array<PlaceResult & { phone?: string }> = [];
  const top = candidates.slice(0, 60);

  console.log(`\nFetching phone numbers for top ${top.length} candidates...`);

  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    process.stdout.write(`  [${i + 1}/${top.length}] ${p.name}... `);
    const details = await getDetails(p.place_id);
    const phone = details?.international_phone_number ?? details?.formatted_phone_number ?? null;
    // Convert to wa.me format: strip non-digits, ensure country code
    const waPhone = phone
      ? phone.replace(/\D/g, '').replace(/^1/, '1') // US numbers already start with 1
      : null;
    enriched.push({ ...p, ...details, phone: waPhone ?? undefined });
    console.log(phone ? `✓ ${phone}` : '(no phone)');
    await sleep(150); // Gentle rate limiting
  }

  // Final output — top 50 with phones prioritized
  const withPhone = enriched.filter((p) => p.phone);
  const withoutPhone = enriched.filter((p) => !p.phone);
  const final = [...withPhone, ...withoutPhone].slice(0, 50);

  console.log(`\nFinal list: ${final.length} prospects (${withPhone.length} with phone, ${withoutPhone.length} without)`);

  // Write JSON file
  const outPath = path.join(process.cwd(), 'scripts', 'key-west-prospects.json');
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2));
  console.log(`\nWritten to: ${outPath}`);

  // Print preview
  console.log('\n── Preview (first 10) ──────────────────────────────────');
  for (const p of final.slice(0, 10)) {
    console.log(`  ${p.name} — ${p.rating}★ (${p.user_ratings_total} reviews) — ${p.phone ?? 'no phone'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

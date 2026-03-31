#!/usr/bin/env npx tsx
/**
 * RateTap Prospecting Script — León, Guanajuato
 *
 * Finds restaurants near La Estancia that could benefit from RateTap.
 * Generates WhatsApp messages + personalized audit page links.
 *
 * Usage:  npx tsx scripts/prospect.ts
 * Cost:   ~$0.10–0.30 USD per run
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('❌ Missing GOOGLE_PLACES_API_KEY in .env.local');
  process.exit(1);
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.ratetapmx.com';

// ─── CHANGE THIS to your real WhatsApp number (with country code, no +) ───
const WHATSAPP_NUMBER = '523311479086';

// ─── Search config ───
// Multiple points to cover more of León — each searches a 3km radius
const SEARCH_LOCATIONS = [
  { name: 'León Centro / La Estancia', lat: 21.1236, lng: -101.6821 },
  { name: 'León Sur (Zona Piel)',      lat: 21.1010, lng: -101.6650 },
  { name: 'León Norte (Blvd López M)', lat: 21.1480, lng: -101.6880 },
  { name: 'León Poniente (Gran Jardín)', lat: 21.1300, lng: -101.7100 },
];
const SEARCH_RADIUS = 3000; // meters

// Sweet-spot filters
const RATING_MIN = 3.5;
const RATING_MAX = 4.3;
const MIN_REVIEWS = 20; // ignore places with too few reviews to care

// ─── Types ───
interface Place {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  vicinity?: string;
  business_status?: string;
  geometry: { location: { lat: number; lng: number } };
}

// ─── Google Places helpers ───
async function nearbySearch(
  lat: number,
  lng: number,
  radius: number,
  pageToken?: string,
): Promise<{ results: Place[]; next_page_token?: string }> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: radius.toString(),
    type: 'restaurant',
    key: API_KEY!,
  });
  if (pageToken) params.set('pagetoken', pageToken);

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`,
  );
  return res.json();
}

async function fetchAllRestaurants(): Promise<{ places: Place[]; apiCalls: number }> {
  const seen = new Set<string>();
  const all: Place[] = [];
  let apiCalls = 0;

  for (const loc of SEARCH_LOCATIONS) {
    let pageToken: string | undefined;

    for (let page = 0; page < 3; page++) {
      const data = await nearbySearch(loc.lat, loc.lng, SEARCH_RADIUS, pageToken);
      apiCalls++;

      for (const place of data.results) {
        if (!seen.has(place.place_id) && place.business_status !== 'CLOSED_PERMANENTLY') {
          seen.add(place.place_id);
          all.push(place);
        }
      }

      pageToken = data.next_page_token;
      if (!pageToken) break;
      // Google requires ~2s before using next_page_token
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return { places: all, apiCalls };
}

// ─── Message generation ───
function makeWhatsAppLink(place: Place, areaAvg: number): string {
  const msg =
    `Hola! Soy de RateTap. Vi que ${place.name} tiene ${place.rating} estrellas ` +
    `en Google con ${place.user_ratings_total} reseñas. ` +
    `El promedio en tu zona es ${areaAvg.toFixed(1)}★. ` +
    `Restaurantes como La Estancia ya usan RateTap para subir su calificación. ` +
    `Te preparé un diagnóstico gratuito: ` +
    `${BASE_URL}/audit/${place.place_id}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}


// ─── Main ───
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║           RATETAP — PROSPECTING TOOL  (León, GTO)              ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Fetch all restaurants
  console.log('🔍 Buscando restaurantes en León...');
  const { places, apiCalls } = await fetchAllRestaurants();
  const rated = places.filter((p) => p.rating && p.user_ratings_total);
  const sorted = [...rated].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const areaAvg = rated.reduce((s, p) => s + (p.rating || 0), 0) / rated.length;

  console.log(`   ✅ ${places.length} restaurantes encontrados (${apiCalls} API calls)\n`);

  // 2. Zone stats
  console.log('📊 ESTADÍSTICAS DE LA ZONA');
  console.log('─'.repeat(64));
  console.log(`   Restaurantes con calificación:  ${rated.length}`);
  console.log(`   Promedio de la zona:            ${areaAvg.toFixed(2)}★`);
  console.log(`   Mejor:  ${sorted[0]?.name} (${sorted[0]?.rating}★, ${sorted[0]?.user_ratings_total} reseñas)`);
  console.log(`   Peor:   ${sorted[sorted.length - 1]?.name} (${sorted[sorted.length - 1]?.rating}★)`);
  console.log('');

  // 3. Sweet-spot prospects
  const prospects = rated
    .filter(
      (p) =>
        (p.rating || 0) >= RATING_MIN &&
        (p.rating || 0) <= RATING_MAX &&
        (p.user_ratings_total || 0) >= MIN_REVIEWS,
    )
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0)); // most reviews first = biggest opportunity

  console.log(`🎯 PROSPECTOS — SWEET SPOT (${RATING_MIN}–${RATING_MAX}★, ${MIN_REVIEWS}+ reseñas): ${prospects.length}`);
  console.log('═'.repeat(64));

  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    const rank = sorted.findIndex((s) => s.place_id === p.place_id) + 1;
    const gap = areaAvg - (p.rating || 0);

    console.log('');
    console.log(`  ${i + 1}. ${p.name}`);
    console.log(`     ⭐ ${p.rating}★  ·  ${p.user_ratings_total} reseñas  ·  #${rank} de ${rated.length} en la zona`);
    console.log(`     📍 ${p.vicinity}`);
    if (gap > 0) {
      console.log(`     📉 ${gap.toFixed(1)} estrellas debajo del promedio de la zona`);
    }
    console.log(`     🔗 Audit:    ${BASE_URL}/audit/${p.place_id}`);
    console.log(`     📱 WhatsApp: ${makeWhatsAppLink(p, areaAvg)}`);
  }

  // 4. Premium leads (already decent, want to protect/grow)
  const premium = rated
    .filter(
      (p) =>
        (p.rating || 0) > RATING_MAX &&
        (p.rating || 0) <= 4.6 &&
        (p.user_ratings_total || 0) >= 50,
    )
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));

  if (premium.length > 0) {
    console.log('');
    console.log(`💎 PREMIUM LEADS (4.4–4.6★ — quieren mantener o subir): ${premium.length}`);
    console.log('═'.repeat(64));
    for (let i = 0; i < Math.min(premium.length, 15); i++) {
      const p = premium[i];
      console.log(`  ${i + 1}. ${p.name} — ${p.rating}★ (${p.user_ratings_total} reseñas)`);
      console.log(`     🔗 ${BASE_URL}/audit/${p.place_id}`);
    }
  }

  // 5. Cost breakdown
  const searchCost = apiCalls * 0.032;
  const auditCostEach = 0.049;
  const totalProspects = prospects.length + premium.length;

  console.log('');
  console.log('💰 COSTOS');
  console.log('─'.repeat(64));
  console.log(`   Esta búsqueda (${apiCalls} Nearby Search calls):   $${searchCost.toFixed(3)} USD`);
  console.log(`   Cada vista de audit page:                   $${auditCostEach.toFixed(3)} USD`);
  console.log(`   Si todos (${totalProspects}) ven su audit:              $${(totalProspects * auditCostEach).toFixed(2)} USD`);
  console.log(`   ─────────────────────────────────────────`);
  console.log(`   COSTO TOTAL MÁXIMO:                        $${(searchCost + totalProspects * auditCostEach).toFixed(2)} USD`);
  console.log('');
  console.log(`   → Un solo cliente nuevo paga esto en minutos 🚀`);
  console.log('');
}

main().catch(console.error);

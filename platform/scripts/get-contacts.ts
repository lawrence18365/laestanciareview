/**
 * Fetch phone numbers for top prospect restaurants
 * Usage: npx tsx scripts/get-contacts.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('Missing GOOGLE_PLACES_API_KEY'); process.exit(1); }

// Top local targets from the prospect run
const targets = [
  { name: 'El Braserío', placeId: 'ChIJtYGwFgC_K4QRrzcK2V5ekvk' },
  { name: 'Restaurant Martin', placeId: 'ChIJxVr-253AK4QRD6kqlPZWjtY' },
  { name: 'Las Fabulosas Papas León', placeId: 'ChIJEbdGtq2_K4QRnFmJzJO05yw' },
  { name: 'Lupillos (Valle del Campestre)', placeId: 'ChIJ15erbVC_K4QRp6TEVSFCVl4' },
  { name: 'Don Carbón León', placeId: 'ChIJNRcD11G_K4QRlOGA4pHOn_g' },
  { name: 'Mendozzinos Pizza', placeId: 'ChIJc2coYNm-K4QRa8zjE_XfiS4' },
  { name: 'Factory Pizza Alitas & Bar', placeId: 'ChIJdxI8Zwu_K4QREiAJb9f578I' },
  { name: 'Okuma Mariano Escobedo', placeId: 'ChIJwbiQs62_K4QRc_sAxxrZ8u8' },
  { name: 'El Patito 4A Generación', placeId: 'ChIJBRq4c1C_K4QRdWh__kenbbw' },
  { name: 'Mariscos Gus', placeId: 'ChIJi7ZeDKfAK4QR4My4-5IHyPw' },
  { name: 'Chanitos Loncheria', placeId: 'ChIJ656Lngy_K4QRj7ZnB2Oy-Ss' },
  { name: 'Green Place leon moderno', placeId: 'ChIJF9bogK6_K4QRL323Kxbhl5M' },
  // Premium leads
  { name: 'Panteón Taurino', placeId: 'ChIJYw2tO3K_K4QR8uM9bpU1sHQ' },
  { name: 'Estación Madero', placeId: 'ChIJsQ98bAi_K4QRNf4tHolU4hQ' },
  { name: 'Pizzas Del Moral Buffet', placeId: 'ChIJNVatBEG_K4QRQxxy2AG0_NM' },
];

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://app.ratetapmx.com';
const WHATSAPP_NUMBER = '523311479086';

async function getDetails(placeId: string) {
  const fields = 'name,rating,user_ratings_total,formatted_phone_number,international_phone_number,website,url';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=es&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || null;
}

async function main() {
  console.log('');
  console.log('📞 CONTACT INFO FOR TOP TARGETS');
  console.log('═'.repeat(70));

  for (const t of targets) {
    const d = await getDetails(t.placeId);
    if (!d) { console.log(`\n❌ ${t.name}: not found`); continue; }

    const phone = d.international_phone_number || d.formatted_phone_number || 'No phone listed';
    const phoneDigits = (d.international_phone_number || '').replace(/\D/g, '');

    console.log(`\n📍 ${d.name}`);
    console.log(`   ⭐ ${d.rating}★ (${d.user_ratings_total} reseñas)`);
    console.log(`   📞 ${phone}`);
    if (d.website) console.log(`   🌐 ${d.website}`);
    console.log(`   📌 Google Maps: ${d.url}`);
    console.log(`   🔗 Audit page: ${BASE_URL}/audit/${t.placeId}`);

    if (phoneDigits) {
      const msg = `Hola, buen día! Soy de RateTap. Trabajo con restaurantes en León como La Estancia, ayudándolos a subir su calificación de Google. Vi que ${d.name} tiene ${d.rating}★ — le preparé un diagnóstico gratuito de su reputación: ${BASE_URL}/audit/${t.placeId} ¿Le puedo platicar 10 minutos? Sin compromiso.`;
      console.log(`   📱 Send WhatsApp: https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`);
    }
  }

  console.log('\n');
  console.log(`💰 Cost: ${targets.length} Place Details calls × $0.017 = $${(targets.length * 0.017).toFixed(2)} USD`);
  console.log('');
}

main().catch(console.error);

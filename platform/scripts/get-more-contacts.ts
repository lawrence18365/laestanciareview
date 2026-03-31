/**
 * Fetch phone numbers for additional prospect restaurants
 * Skipping chains — only local/independent spots
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('Missing GOOGLE_PLACES_API_KEY'); process.exit(1); }

const targets = [
  // HOT — local independents below or at average
  { name: 'Tortas Poncho', placeId: 'ChIJT82CJke_K4QR2iTJjzM_4Lw', rating: 4.1, reviews: 1469 },
  { name: 'KSushi León - San Pedro', placeId: 'ChIJE9s_OOS-K4QR33YCnDJuFZk', rating: 4.3, reviews: 1180 },
  { name: 'Sushitai - Mariano Escobedo', placeId: 'ChIJ31mFRa-_K4QRSwoHexkPADc', rating: 4.3, reviews: 883 },
  { name: 'Sushi Star', placeId: 'ChIJKwmgylG_K4QRtpZGsdv0-_o', rating: 4.3, reviews: 544 },
  { name: 'Banquetes Danny', placeId: 'ChIJ_fBdvkW_K4QR8UULhUiWmgU', rating: 4.3, reviews: 534 },
  { name: 'Chanitos Loncheria', placeId: 'ChIJ656Lngy_K4QRj7ZnB2Oy-Ss', rating: 4.3, reviews: 566 },
  { name: 'Ciao!', placeId: 'ChIJo8OE7HC_K4QR7qHz3n1rEEk', rating: 4.3, reviews: 396 },
  { name: 'Woki Tokee Campestre', placeId: 'ChIJe8u9dkW_K4QR-T3jipzmVO4', rating: 4.1, reviews: 300 },
  { name: 'Tamales 5 de Mayo', placeId: 'ChIJbTc9ewu_K4QRuirSpEdjeXg', rating: 4.2, reviews: 410 },
  { name: 'deligo!', placeId: 'ChIJ9UHPwQC_K4QRVAmGEw9tD1I', rating: 4.2, reviews: 408 },
  { name: 'Vancouver Wings Leon', placeId: 'ChIJR8bxY02-K4QR_DBOrbwkHXU', rating: 3.9, reviews: 1150 },
  { name: 'Wing\'s Army Plaza Teocalli', placeId: 'ChIJRyrXNlG_K4QRnl0izmLmp_8', rating: 4.1, reviews: 839 },
  // PREMIUM — big fish
  { name: 'Mr. Pampas do Brasil', placeId: 'ChIJl4Ekp02-K4QR9C3a2N5CKWo', rating: 4.6, reviews: 11197 },
  { name: 'Las Moras Café', placeId: 'ChIJPRnjume-K4QRRguNXgDgMg8', rating: 4.6, reviews: 8802 },
  { name: 'TACOS EL PATA LEÓN', placeId: 'ChIJYaB-OOS_K4QRixgZQpyfJ_g', rating: 4.4, reviews: 5429 },
  { name: 'Museo del Viento', placeId: 'ChIJG8-I0Qu_K4QRk46JA9At0a8', rating: 4.5, reviews: 4882 },
  { name: 'Brasil 2000', placeId: 'ChIJN_o95aW_K4QRGfFfNCT-93Y', rating: 4.5, reviews: 3230 },
  { name: 'Carnitas CUIC', placeId: 'ChIJ69M5ToDAK4QRuchub5WeyLw', rating: 4.4, reviews: 2732 },
  { name: 'Restaurant Bar Jaibol', placeId: 'ChIJh3gr9gu_K4QRU6lt2YLXh0c', rating: 4.6, reviews: 2699 },
  { name: 'El Rincón Gaucho', placeId: 'ChIJ-Wjgn06_K4QRcmqQSThsdxM', rating: 4.5, reviews: 2604 },
];

async function getDetails(placeId: string) {
  const fields = 'name,rating,user_ratings_total,formatted_phone_number,international_phone_number,website';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=es&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || null;
}

async function main() {
  console.log('// Paste this into the prospects array:\n');

  for (const t of targets) {
    const d = await getDetails(t.placeId);
    const phone = d?.international_phone_number?.replace(/\D/g, '') || '';
    const tag = t.rating >= 4.4 ? 'premium' : 'hot';

    if (phone) {
      console.log(`  { name: '${(d?.name || t.name).replace(/'/g, "\\'")}', placeId: '${t.placeId}', rating: ${d?.rating || t.rating}, reviews: ${d?.user_ratings_total || t.reviews}, phone: '${phone}', tag: '${tag}'${t.reviews >= 1000 ? `, note: '${t.reviews.toLocaleString()}+ reseñas'` : ''} },`);
    } else {
      console.log(`  // SKIP: ${t.name} — no phone listed`);
    }
  }

  console.log(`\n// Cost: ${targets.length} calls × $0.017 = $${(targets.length * 0.017).toFixed(2)}`);
}

main().catch(console.error);

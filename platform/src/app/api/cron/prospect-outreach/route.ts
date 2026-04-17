/**
 * Weekly cron: discover new restaurant prospects via Google Places,
 * add to prospect_queue, blast SMS via Telnyx to uncontacted ones.
 *
 * Schedule: every Monday 10am Mexico City time (16:00 UTC)
 * Vercel cron: "0 16 * * 1"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { prospectQueue } from '@/db/schema';
import { eq, isNull } from 'drizzle-orm';
import Telnyx from 'telnyx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE_URL = 'https://app.ratetapmx.com';

// Target cities: [name, lat, lng]
const CITIES: [string, number, number][] = [
  ['León',          21.1236, -101.6821],
  ['Guadalajara',   20.6597,  -103.3496],
  ['Querétaro',     20.5888,  -100.3899],
  ['San Miguel',    20.9144,  -100.7452],
];

const PLACES_KEY = (process.env.GOOGLE_PLACES_API_KEY ?? '').replace(/\\n/g, '').trim();
const TELNYX_KEY = process.env.TELNYX_API_KEY?.trim();
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER?.trim() ?? process.env.TELNYX_FROM?.trim();
const CRON_SECRET = process.env.CRON_SECRET;

function smsMessage(name: string, rating: string, placeId: string): string {
  return `Hola ${name}, preparamos un análisis gratuito de sus reseñas de Google (actualmente ${rating}★). Sin costo: ${BASE_URL}/audit/${placeId} — RateTap`;
}

async function discoverCity(city: string, lat: number, lng: number): Promise<{ placeId: string; name: string; rating: string; reviewCount: number; phone: string | null }[]> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: '4000',
    type: 'restaurant',
    key: PLACES_KEY,
  });

  const results: { placeId: string; name: string; rating: string; reviewCount: number; phone: string | null }[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    if (pageToken) params.set('pagetoken', pageToken);
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`);
    const data = await res.json() as { results: { place_id: string; name: string; rating?: number; user_ratings_total?: number }[]; next_page_token?: string };

    for (const p of data.results) {
      const rating = p.rating ?? 0;
      const reviews = p.user_ratings_total ?? 0;
      if (rating >= 3.5 && rating <= 4.3 && reviews >= 50) {
        // Get phone from Details API
        let phone: string | null = null;
        try {
          const dRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=international_phone_number&key=${PLACES_KEY}`);
          const dData = await dRes.json() as { result?: { international_phone_number?: string } };
          phone = dData.result?.international_phone_number?.replace(/\s/g, '') ?? null;
        } catch { /* skip */ }

        results.push({ placeId: p.place_id, name: p.name, rating: String(rating), reviewCount: reviews, phone });
        await new Promise(r => setTimeout(r, 150)); // rate limit
      }
    }

    pageToken = data.next_page_token;
    if (!pageToken) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

export async function GET(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (auth !== CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discovered: string[] = [];
  const queued: string[] = [];
  const sent: string[] = [];

  // 1. Discover new prospects across all cities
  for (const [city, lat, lng] of CITIES) {
    const prospects = await discoverCity(city, lat, lng);

    for (const p of prospects) {
      try {
        await db.insert(prospectQueue).values({
          placeId: p.placeId,
          restaurantName: p.name,
          rating: p.rating,
          reviewCount: p.reviewCount,
          phone: p.phone,
          city,
        }).onConflictDoNothing();
        discovered.push(p.name);
      } catch { /* already exists */ }
    }
  }

  // 2. SMS all pending prospects that have a phone number
  if (TELNYX_KEY && TELNYX_PHONE) {
    const telnyx = new Telnyx({ apiKey: TELNYX_KEY });
    const pending = await db.select().from(prospectQueue)
      .where(eq(prospectQueue.status, 'pending'));

    for (const p of pending) {
      if (!p.phone) continue;

      try {
        await (telnyx.messages as unknown as { create: (p: Record<string, string>) => Promise<unknown> }).create({
          from: TELNYX_PHONE,
          to: p.phone,
          text: smsMessage(p.restaurantName, p.rating ?? '?', p.placeId),
        });

        await db.update(prospectQueue)
          .set({ status: 'contacted', contactedAt: new Date() })
          .where(eq(prospectQueue.placeId, p.placeId));

        sent.push(p.restaurantName);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[prospect-outreach] SMS failed for ${p.restaurantName}:`, err);
      }
    }
  }

  console.log(`[prospect-outreach] discovered=${discovered.length} sent=${sent.length}`);
  return Response.json({ discovered: discovered.length, queued: queued.length, sent: sent.length });
}

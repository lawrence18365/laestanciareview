/**
 * Weekly cron: discover new restaurant prospects via Google Places,
 * add to prospect_queue, blast SMS via Telnyx to uncontacted ones.
 *
 * Schedule: every Monday 10am Mexico City time (16:00 UTC)
 * Vercel cron: "0 16 * * 1"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { commercialLeads, prospectQueue, restaurants } from '@/db/schema';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import Telnyx from 'telnyx';
import {
  addDays,
  auditPath,
  ensureCommercialLeadForProspect,
  logProspectOutreachEvent,
} from '@/lib/outreach-tracking';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

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
const TELNYX_KEY = process.env.TELNYX_API_KEY?.trim() ?? process.env.TELNYX_API_TOKEN?.trim();
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER?.trim()
  ?? process.env.TELNYX_FROM_NUMBER?.trim()
  ?? process.env.TELNYX_FROM?.trim();
const CRON_SECRET = process.env.CRON_SECRET;
const OUTREACH_DAILY_LIMIT = Number(process.env.OUTREACH_DAILY_LIMIT ?? 20);

function smsMessage(name: string, rating: string, placeId: string): string {
  return `Hola ${name}, preparamos un análisis gratuito de sus reseñas de Google (actualmente ${rating}★). Sin costo: ${BASE_URL}/audit/${placeId} (RateTap)`;
}

function providerMessageId(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const direct = 'id' in message ? (message as { id?: unknown }).id : undefined;
  if (typeof direct === 'string') return direct;
  const data = 'data' in message ? (message as { data?: unknown }).data : undefined;
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
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
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || auth !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discovered: string[] = [];
  const queued: string[] = [];
  const sent: string[] = [];
  const failed: string[] = [];

  // 1. Discover new prospects across all cities
  for (const [city, lat, lng] of CITIES) {
    const prospects = await discoverCity(city, lat, lng);

    for (const p of prospects) {
      try {
        const inserted = await db.insert(prospectQueue).values({
          placeId: p.placeId,
          restaurantName: p.name,
          rating: p.rating,
          reviewCount: p.reviewCount,
          phone: p.phone,
          city,
          status: p.phone ? 'identified' : 'no_phone',
        }).onConflictDoNothing().returning({ placeId: prospectQueue.placeId });

        if (inserted.length > 0) {
          discovered.push(p.name);
          await logProspectOutreachEvent({
            placeId: p.placeId,
            eventName: 'prospect_identified',
            status: p.phone ? 'identified' : 'no_phone',
            payload: {
              restaurant_name: p.name,
              city,
              rating: p.rating,
              review_count: p.reviewCount,
              has_phone: Boolean(p.phone),
            },
          });
        }
      } catch { /* already exists */ }
    }
  }

  const signedUpPlaceIds = new Set(
    (await db.select({ placeId: restaurants.googlePlaceId }).from(restaurants)
      .where(sql`google_place_id IS NOT NULL`))
      .map((r) => r.placeId)
      .filter(Boolean),
  );

  // 2. SMS all pending prospects that have a phone number
  if (TELNYX_KEY && TELNYX_PHONE) {
    const telnyx = new Telnyx({ apiKey: TELNYX_KEY });
    const pending = await db.select().from(prospectQueue)
      .where(
        and(
          inArray(prospectQueue.status, ['pending', 'identified', 'queued', 'failed']),
          or(isNull(prospectQueue.nextActionAt), lte(prospectQueue.nextActionAt, new Date())),
        ),
      )
      .orderBy(asc(prospectQueue.createdAt))
      .limit(Number.isFinite(OUTREACH_DAILY_LIMIT) ? OUTREACH_DAILY_LIMIT : 20);

    for (const p of pending) {
      if (signedUpPlaceIds.has(p.placeId)) {
        await db.update(prospectQueue)
          .set({ status: 'won', wonAt: new Date(), updatedAt: new Date() })
          .where(eq(prospectQueue.placeId, p.placeId));
        continue;
      }

      if (!p.phone) {
        await db.update(prospectQueue)
          .set({ status: 'no_phone', lastError: 'missing_phone', updatedAt: new Date() })
          .where(eq(prospectQueue.placeId, p.placeId));
        continue;
      }

      try {
        await db.update(prospectQueue)
          .set({ status: 'queued', updatedAt: new Date() })
          .where(eq(prospectQueue.placeId, p.placeId));
        queued.push(p.restaurantName);

        await logProspectOutreachEvent({
          placeId: p.placeId,
          commercialLeadId: p.commercialLeadId,
          eventName: 'outreach_queued',
          provider: 'telnyx',
          status: 'queued',
        });

        const message = await (telnyx.messages as unknown as { create: (p: Record<string, string>) => Promise<unknown> }).create({
          from: TELNYX_PHONE,
          to: p.phone,
          text: smsMessage(p.restaurantName, p.rating ?? '?', p.placeId),
        });
        const messageId = providerMessageId(message);
        const now = new Date();
        const nextActionAt = addDays(2);
        const lead = await ensureCommercialLeadForProspect(p, 'outbound_sms');

        await db.update(prospectQueue)
          .set({
            status: 'sent',
            commercialLeadId: lead.id,
            deliveryStatus: 'sent',
            provider: 'telnyx',
            providerMessageId: messageId,
            contactedAt: p.contactedAt ?? now,
            lastOutreachAt: now,
            nextActionAt,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(prospectQueue.placeId, p.placeId));

        await db.update(commercialLeads)
          .set({
            status: lead.status === 'new' ? 'contacted' : lead.status,
            contactedAt: lead.contactedAt ?? now,
            nextAction: `Follow up on outbound audit for ${p.restaurantName}`,
            nextActionAt,
            updatedAt: now,
          })
          .where(eq(commercialLeads.id, lead.id));

        await trackCommercialEvent({
          eventName: 'lead_contacted',
          leadId: lead.id,
          source: 'outbound_sms',
          path: auditPath(p.placeId),
          metadata: {
            place_id: p.placeId,
            provider_message_id: messageId,
          },
        });

        await logProspectOutreachEvent({
          placeId: p.placeId,
          commercialLeadId: lead.id,
          eventName: 'outreach_sent',
          provider: 'telnyx',
          providerMessageId: messageId,
          status: 'sent',
          payload: { phone: p.phone },
        });

        sent.push(p.restaurantName);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.update(prospectQueue)
          .set({
            status: 'failed',
            deliveryStatus: 'failed',
            lastError: message,
            nextActionAt: addDays(1),
            updatedAt: new Date(),
          })
          .where(eq(prospectQueue.placeId, p.placeId));
        await logProspectOutreachEvent({
          placeId: p.placeId,
          commercialLeadId: p.commercialLeadId,
          eventName: 'outreach_failed',
          provider: 'telnyx',
          status: 'failed',
          error: message,
        });
        failed.push(p.restaurantName);
        console.error(`[prospect-outreach] SMS failed for ${p.restaurantName}:`, err);
      }
    }
  }

  console.log(`[prospect-outreach] discovered=${discovered.length} queued=${queued.length} sent=${sent.length} failed=${failed.length}`);
  return Response.json({
    discovered: discovered.length,
    queued: queued.length,
    sent: sent.length,
    failed: failed.length,
  });
}

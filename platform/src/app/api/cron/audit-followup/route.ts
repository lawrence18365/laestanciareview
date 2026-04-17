/**
 * Daily cron: find prospects who visited an audit page but haven't signed up.
 * Sends a follow-up SMS 24h after their first view.
 *
 * Schedule: every day at 11am Mexico City (17:00 UTC)
 * Vercel cron: "0 17 * * *"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { prospectViews, prospectQueue, restaurants } from '@/db/schema';
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import Telnyx from 'telnyx';

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://app.ratetapmx.com';
const TELNYX_KEY = process.env.TELNYX_API_KEY?.trim();
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER?.trim() ?? process.env.TELNYX_FROM?.trim();
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (auth !== CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Audit views older than 24h that haven't been followed up yet
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const views = await db.select().from(prospectViews)
    .where(and(
      lt(prospectViews.firstViewAt, cutoff),
      isNull(prospectViews.lastNotifiedAt),
    ));

  // Also check: did this place_id sign up already?
  const signedUpPlaceIds = new Set(
    (await db.select({ placeId: restaurants.googlePlaceId }).from(restaurants)
      .where(sql`google_place_id IS NOT NULL`))
      .map(r => r.placeId)
  );

  let sent = 0;

  if (!TELNYX_KEY || !TELNYX_PHONE) {
    return Response.json({ sent: 0, reason: 'Telnyx not configured' });
  }

  const telnyx = new Telnyx({ apiKey: TELNYX_KEY });

  for (const view of views) {
    if (signedUpPlaceIds.has(view.placeId)) continue; // already a customer

    // Look up phone from prospect_queue
    const [prospect] = await db.select().from(prospectQueue)
      .where(eq(prospectQueue.placeId, view.placeId)).limit(1);

    if (!prospect?.phone) continue;

    const msg = `Hola! Vi que revisaron el diagnóstico de ${view.restaurantName}. ¿Tienen alguna pregunta? La prueba gratis es por 15 días, sin tarjeta: ${BASE_URL}/contacto — RateTap`;

    try {
      await (telnyx.messages as unknown as { create: (p: Record<string, string>) => Promise<unknown> }).create({
        from: TELNYX_PHONE,
        to: prospect.phone,
        text: msg,
      });

      await db.update(prospectViews)
        .set({ lastNotifiedAt: new Date() })
        .where(eq(prospectViews.placeId, view.placeId));

      sent++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[audit-followup] SMS failed for ${view.restaurantName}:`, err);
    }
  }

  console.log(`[audit-followup] sent=${sent}`);
  return Response.json({ sent });
}

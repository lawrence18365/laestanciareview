import { NextRequest } from 'next/server';
import { db } from '@/db';
import { commercialLeads, prospectQueue, prospectViews } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireSameOrigin } from '@/lib/origin';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { logProspectOutreachEvent } from '@/lib/outreach-tracking';

export const dynamic = 'force-dynamic';

const OWNER_PHONE = (process.env.OWNER_NOTIFY_PHONE ?? process.env.PROSPECT_WHATSAPP ?? '523311479086').trim();
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com').replace(/\\n/g, '').trim().replace(/\/$/, '');

async function notifyOwner(restaurantName: string, placeId: string, rating: string | null, viewCount: number, isFirst: boolean) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !authToken || !from) return;

  const fire = isFirst ? '🔥 PRIMERA VISITA' : `👀 Visita #${viewCount}`;
  const lines = [
    `${fire} — *${restaurantName}*`,
    rating ? `⭐ ${rating} en Google` : '',
    ``,
    `${BASE_URL}/audit/${placeId}`,
    ``,
    `Escríbeles ahora que están viendo sus datos.`,
  ].filter(Boolean);

  let digits = OWNER_PHONE.replace(/\D/g, '');
  if (digits.length === 10) digits = '52' + digits;

  const body = new URLSearchParams({
    To: `whatsapp:+${digits}`,
    From: `whatsapp:${from}`,
    Body: lines.join('\n'),
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

async function markProspectViewed(placeId: string, restaurantName: string) {
  const [prospect] = await db
    .select()
    .from(prospectQueue)
    .where(eq(prospectQueue.placeId, placeId))
    .limit(1);
  if (!prospect) return;

  const now = new Date();
  const preserve = new Set(['replied', 'demo_booked', 'won', 'lost']);
  const nextStatus = preserve.has(prospect.status) ? prospect.status : 'viewed';

  await db
    .update(prospectQueue)
    .set({
      status: nextStatus,
      viewedAt: now,
      nextActionAt: now,
      updatedAt: now,
    })
    .where(eq(prospectQueue.placeId, placeId));

  if (prospect.commercialLeadId) {
    await db
      .update(commercialLeads)
      .set({
        nextAction: `Prospect viewed audit for ${restaurantName}. Contact now.`,
        nextActionAt: now,
        updatedAt: now,
      })
      .where(eq(commercialLeads.id, prospect.commercialLeadId));
  }

  await logProspectOutreachEvent({
    placeId,
    commercialLeadId: prospect.commercialLeadId,
    eventName: 'outreach_viewed',
    provider: 'audit_page',
    status: nextStatus,
    payload: { restaurant_name: restaurantName },
  });
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  // Bound the WhatsApp-notify spam vector: 30 hits/min/IP across all placeIds.
  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`audit-track:${ip}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { placeId, restaurantName, rating } = (await req.json()) as {
      placeId: string;
      restaurantName: string;
      rating?: string;
    };

    if (
      !placeId || typeof placeId !== 'string' || placeId.length > 300 ||
      !restaurantName || typeof restaurantName !== 'string' || restaurantName.length > 300 ||
      (rating !== undefined && (typeof rating !== 'string' || rating.length > 20))
    ) {
      return Response.json({ ok: false }, { status: 400 });
    }

    const now = new Date();
    const existing = await db.select().from(prospectViews).where(eq(prospectViews.placeId, placeId)).limit(1);

    if (existing.length === 0) {
      await db.insert(prospectViews).values({
        placeId,
        restaurantName,
        rating: rating ?? null,
        lastNotifiedAt: now,
      });
      await markProspectViewed(placeId, restaurantName);
      notifyOwner(restaurantName, placeId, rating ?? null, 1, true).catch(() => {});
    } else {
      const e = existing[0];
      const newCount = e.viewCount + 1;
      const hoursSince = e.lastNotifiedAt
        ? (now.getTime() - e.lastNotifiedAt.getTime()) / 3_600_000
        : Infinity;

      await db.update(prospectViews)
        .set({
          viewCount: newCount,
          lastViewAt: now,
          ...(hoursSince > 6 ? { lastNotifiedAt: now } : {}),
        })
        .where(eq(prospectViews.placeId, placeId));

      if (hoursSince > 6) {
        notifyOwner(restaurantName, placeId, rating ?? null, newCount, false).catch(() => {});
      }
      await markProspectViewed(placeId, restaurantName);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[audit/track]', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}

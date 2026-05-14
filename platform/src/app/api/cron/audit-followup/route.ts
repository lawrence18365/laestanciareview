/**
 * Daily cron: find prospects who visited an audit page but haven't signed up.
 * Sends a follow-up SMS 24h after their first view.
 *
 * Schedule: every day at 11am Mexico City (17:00 UTC)
 * Vercel cron: "0 17 * * *"
 */
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { commercialLeads, prospectViews, prospectQueue, restaurants } from '@/db/schema';
import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import Telnyx from 'telnyx';
import {
  addDays,
  ensureCommercialLeadForProspect,
  logProspectOutreachEvent,
} from '@/lib/outreach-tracking';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://app.ratetapmx.com';
const TELNYX_KEY = process.env.TELNYX_API_KEY?.trim() ?? process.env.TELNYX_API_TOKEN?.trim();
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER?.trim()
  ?? process.env.TELNYX_FROM_NUMBER?.trim()
  ?? process.env.TELNYX_FROM?.trim();
const CRON_SECRET = process.env.CRON_SECRET;

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

export async function GET(req: NextRequest) {
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET is not configured');
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!auth || auth !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Audit views older than 24h that haven't received the prospect follow-up.
  // `lastNotifiedAt` is used for owner notifications from /api/audit/track.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const views = await db.select().from(prospectViews)
    .where(and(
      lt(prospectViews.firstViewAt, cutoff),
      isNull(prospectViews.lastFollowUpAt),
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

    const msg = `Hola! Vi que revisaron el diagnóstico de ${view.restaurantName}. ¿Tienen alguna pregunta? La prueba gratis es por 15 días, sin cargo hoy y pueden cancelar antes del cobro: ${BASE_URL}/contacto — RateTap`;

    try {
      const lead = await ensureCommercialLeadForProspect(prospect, 'audit_followup');
      const message = await (telnyx.messages as unknown as { create: (p: Record<string, string>) => Promise<unknown> }).create({
        from: TELNYX_PHONE,
        to: prospect.phone,
        text: msg,
      });
      const messageId = providerMessageId(message);
      const now = new Date();
      const nextActionAt = addDays(2);

      await db.update(prospectViews)
        .set({ lastFollowUpAt: now })
        .where(eq(prospectViews.placeId, view.placeId));

      await db.update(prospectQueue)
        .set({
          commercialLeadId: lead.id,
          status: 'sent',
          deliveryStatus: 'sent',
          provider: 'telnyx',
          providerMessageId: messageId,
          lastFollowUpAt: now,
          lastOutreachAt: now,
          nextActionAt,
          followUpCount: sql`${prospectQueue.followUpCount} + 1`,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(prospectQueue.placeId, view.placeId));

      await db.update(commercialLeads)
        .set({
          status: lead.status === 'new' ? 'contacted' : lead.status,
          contactedAt: lead.contactedAt ?? now,
          nextAction: `Follow up after audit view for ${view.restaurantName}`,
          nextActionAt,
          updatedAt: now,
        })
        .where(eq(commercialLeads.id, lead.id));

      await trackCommercialEvent({
        eventName: 'lead_contacted',
        leadId: lead.id,
        source: 'audit_followup',
        path: `/audit/${view.placeId}`,
        metadata: {
          place_id: view.placeId,
          provider_message_id: messageId,
        },
      });

      await logProspectOutreachEvent({
        placeId: view.placeId,
        commercialLeadId: lead.id,
        eventName: 'outreach_sent',
        provider: 'telnyx',
        providerMessageId: messageId,
        status: 'sent',
        payload: { stage: 'audit_followup' },
      });

      sent++;
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
        .where(eq(prospectQueue.placeId, view.placeId));
      await logProspectOutreachEvent({
        placeId: view.placeId,
        commercialLeadId: prospect.commercialLeadId,
        eventName: 'outreach_failed',
        provider: 'telnyx',
        status: 'failed',
        payload: { stage: 'audit_followup' },
        error: message,
      });
      console.error(`[audit-followup] SMS failed for ${view.restaurantName}:`, err);
    }
  }

  console.log(`[audit-followup] sent=${sent}`);
  return Response.json({ sent });
}

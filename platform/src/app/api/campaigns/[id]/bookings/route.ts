import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaignBookings, campaignContacts, eventCampaigns } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import {
  calculateBookingEconomics,
  campaignBookingSchema,
  contactTimestamps,
} from '@/lib/event-campaigns';

export const runtime = 'nodejs';

function bookingDates(status: string, depositAmount: number, now = new Date()) {
  return {
    ...(depositAmount > 0 ? { depositReceivedAt: now } : {}),
    ...(['booked', 'attended'].includes(status) ? { bookedAt: now } : {}),
    ...(status === 'attended' ? { attendedAt: now } : {}),
    ...(['cancelled', 'refunded'].includes(status) ? { cancelledAt: now } : {}),
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });
  const campaignId = Number((await params).id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const parsed = campaignBookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [campaign] = await db
    .select({ id: eventCampaigns.id, feePercent: eventCampaigns.feePercent })
    .from(eventCampaigns)
    .where(
      and(
        eq(eventCampaigns.id, campaignId),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!campaign) return Response.json({ error: 'Not found' }, { status: 404 });

  let guestId: number | null = null;
  if (parsed.data.contactId) {
    const [contact] = await db
      .select({ guestId: campaignContacts.guestId })
      .from(campaignContacts)
      .where(
        and(
          eq(campaignContacts.id, parsed.data.contactId),
          eq(campaignContacts.campaignId, campaignId),
          eq(campaignContacts.restaurantId, restaurant.id),
        ),
      )
      .limit(1);
    if (!contact) return Response.json({ error: 'Contact not found' }, { status: 404 });
    guestId = contact.guestId;
  }

  const economics = calculateBookingEconomics(parsed.data, Number(campaign.feePercent));
  const now = new Date();
  const [booking] = await db
    .insert(campaignBookings)
    .values({
      campaignId,
      restaurantId: restaurant.id,
      contactId: parsed.data.contactId,
      guestId,
      clientName: parsed.data.clientName,
      clientPhone: parsed.data.clientPhone,
      partySize: parsed.data.partySize,
      status: parsed.data.status,
      attributionSource: parsed.data.attributionSource,
      attributionEvidence: parsed.data.attributionEvidence,
      bookedAmount: parsed.data.bookedAmount.toFixed(2),
      depositAmount: parsed.data.depositAmount.toFixed(2),
      collectedAmount: parsed.data.collectedAmount.toFixed(2),
      refundedAmount: parsed.data.refundedAmount.toFixed(2),
      ivaAmount: parsed.data.ivaAmount.toFixed(2),
      serviceChargeAmount: parsed.data.serviceChargeAmount.toFixed(2),
      gratuityAmount: parsed.data.gratuityAmount.toFixed(2),
      ...economics,
      ...bookingDates(parsed.data.status, parsed.data.depositAmount, now),
    })
    .returning();

  if (parsed.data.contactId) {
    const contactStatus = ['booked', 'attended'].includes(parsed.data.status)
      ? 'booked'
      : parsed.data.status === 'deposit_pending'
        ? 'deposit_pending'
        : 'interested';
    await db
      .update(campaignContacts)
      .set({ status: contactStatus, ...contactTimestamps(contactStatus, now) })
      .where(
        and(
          eq(campaignContacts.id, parsed.data.contactId),
          eq(campaignContacts.campaignId, campaignId),
          eq(campaignContacts.restaurantId, restaurant.id),
        ),
      );
  }

  return Response.json({ booking }, { status: 201 });
}

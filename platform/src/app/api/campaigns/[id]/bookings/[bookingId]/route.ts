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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bookingId: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const routeParams = await params;
  const campaignId = Number(routeParams.id);
  const bookingId = Number(routeParams.bookingId);
  if (![campaignId, bookingId].every((value) => Number.isInteger(value) && value > 0)) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const parsed = campaignBookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({
      id: campaignBookings.id,
      contactId: campaignBookings.contactId,
      feePercent: eventCampaigns.feePercent,
      depositReceivedAt: campaignBookings.depositReceivedAt,
      bookedAt: campaignBookings.bookedAt,
      attendedAt: campaignBookings.attendedAt,
      cancelledAt: campaignBookings.cancelledAt,
    })
    .from(campaignBookings)
    .innerJoin(eventCampaigns, eq(eventCampaigns.id, campaignBookings.campaignId))
    .where(
      and(
        eq(campaignBookings.id, bookingId),
        eq(campaignBookings.campaignId, campaignId),
        eq(campaignBookings.restaurantId, restaurant.id),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const economics = calculateBookingEconomics(parsed.data, Number(existing.feePercent));
  const now = new Date();
  const [booking] = await db
    .update(campaignBookings)
    .set({
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
      depositReceivedAt:
        parsed.data.depositAmount > 0 ? existing.depositReceivedAt ?? now : null,
      bookedAt: ['booked', 'attended'].includes(parsed.data.status)
        ? existing.bookedAt ?? now
        : null,
      attendedAt: parsed.data.status === 'attended' ? existing.attendedAt ?? now : null,
      cancelledAt: ['cancelled', 'refunded'].includes(parsed.data.status)
        ? existing.cancelledAt ?? now
        : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(campaignBookings.id, bookingId),
        eq(campaignBookings.campaignId, campaignId),
        eq(campaignBookings.restaurantId, restaurant.id),
      ),
    )
    .returning();

  if (existing.contactId) {
    const contactStatus = ['booked', 'attended'].includes(parsed.data.status)
      ? 'booked'
      : parsed.data.status === 'deposit_pending'
        ? 'deposit_pending'
        : parsed.data.status === 'cancelled' || parsed.data.status === 'refunded'
          ? 'declined'
          : 'interested';
    await db
      .update(campaignContacts)
      .set({ status: contactStatus, ...contactTimestamps(contactStatus, now) })
      .where(
        and(
          eq(campaignContacts.id, existing.contactId),
          eq(campaignContacts.campaignId, campaignId),
          eq(campaignContacts.restaurantId, restaurant.id),
        ),
      );
  }

  return Response.json({ booking });
}

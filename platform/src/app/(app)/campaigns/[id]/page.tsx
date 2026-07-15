import { notFound, redirect } from 'next/navigation';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaignBookings,
  campaignContacts,
  eventCampaigns,
  guests,
  guestVisits,
} from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import CampaignWorkspace from './CampaignWorkspace';

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const campaignId = Number((await params).id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();

  const [campaign] = await db
    .select()
    .from(eventCampaigns)
    .where(
      and(
        eq(eventCampaigns.id, campaignId),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!campaign) notFound();

  const [contacts, bookings] = await Promise.all([
    db
      .select({
        id: campaignContacts.id,
        guestId: campaignContacts.guestId,
        segment: campaignContacts.segment,
        priority: campaignContacts.priority,
        status: campaignContacts.status,
        openedAt: campaignContacts.openedAt,
        sentAt: campaignContacts.sentAt,
        repliedAt: campaignContacts.repliedAt,
        optedOutAt: campaignContacts.optedOutAt,
        notes: campaignContacts.notes,
        name: guests.name,
        whatsapp: guests.whatsapp,
        birthdayMmdd: guests.birthdayMmdd,
        preferences: guests.preferences,
        marketingConsent: guests.marketingConsent,
        guestStatus: guests.status,
        redemptionType: guests.redemptionType,
        visitCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${guestVisits}
          WHERE ${guestVisits.guestId} = ${guests.id}
            AND ${guestVisits.restaurantId} = ${restaurant.id}
        )`.mapWith(Number),
      })
      .from(campaignContacts)
      .innerJoin(guests, eq(guests.id, campaignContacts.guestId))
      .where(
        and(
          eq(campaignContacts.campaignId, campaignId),
          eq(campaignContacts.restaurantId, restaurant.id),
        ),
      )
      .orderBy(asc(campaignContacts.priority), asc(campaignContacts.id)),
    db
      .select()
      .from(campaignBookings)
      .where(
        and(
          eq(campaignBookings.campaignId, campaignId),
          eq(campaignBookings.restaurantId, restaurant.id),
        ),
      )
      .orderBy(desc(campaignBookings.createdAt)),
  ]);

  return (
    <CampaignWorkspace
      restaurantName={restaurant.name}
      campaign={{
        ...campaign,
        audienceSeededAt: campaign.audienceSeededAt?.toISOString() ?? null,
        launchedAt: campaign.launchedAt?.toISOString() ?? null,
        completedAt: campaign.completedAt?.toISOString() ?? null,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      }}
      initialContacts={contacts.map((contact) => ({
        ...contact,
        openedAt: contact.openedAt?.toISOString() ?? null,
        sentAt: contact.sentAt?.toISOString() ?? null,
        repliedAt: contact.repliedAt?.toISOString() ?? null,
        optedOutAt: contact.optedOutAt?.toISOString() ?? null,
      }))}
      initialBookings={bookings.map((booking) => ({
        ...booking,
        depositReceivedAt: booking.depositReceivedAt?.toISOString() ?? null,
        bookedAt: booking.bookedAt?.toISOString() ?? null,
        attendedAt: booking.attendedAt?.toISOString() ?? null,
        cancelledAt: booking.cancelledAt?.toISOString() ?? null,
        createdAt: booking.createdAt.toISOString(),
        updatedAt: booking.updatedAt.toISOString(),
      }))}
    />
  );
}

import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignBookings, campaignContacts, eventCampaigns } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import CampaignsDashboard from './CampaignsDashboard';

export default async function CampaignsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const campaigns = await db
    .select({
      id: eventCampaigns.id,
      name: eventCampaigns.name,
      slug: eventCampaigns.slug,
      status: eventCampaigns.status,
      campaignType: eventCampaigns.campaignType,
      audienceRule: eventCampaigns.audienceRule,
      eventDate: eventCampaigns.eventDate,
      eventTime: eventCampaigns.eventTime,
      offerName: eventCampaigns.offerName,
      pricePerPerson: eventCampaigns.pricePerPerson,
      capacity: eventCampaigns.capacity,
      minimumSeats: eventCampaigns.minimumSeats,
      feePercent: eventCampaigns.feePercent,
      audience: sql<number>`(
        SELECT COUNT(*)::int FROM ${campaignContacts}
        WHERE ${campaignContacts.campaignId} = ${eventCampaigns.id}
      )`.mapWith(Number),
      contacted: sql<number>`(
        SELECT COUNT(*)::int FROM ${campaignContacts}
        WHERE ${campaignContacts.campaignId} = ${eventCampaigns.id}
          AND ${campaignContacts.sentAt} IS NOT NULL
      )`.mapWith(Number),
      bookedSeats: sql<number>`COALESCE((
        SELECT SUM(${campaignBookings.partySize})::int FROM ${campaignBookings}
        WHERE ${campaignBookings.campaignId} = ${eventCampaigns.id}
          AND ${campaignBookings.status} IN ('booked', 'attended')
      ), 0)`.mapWith(Number),
      bookedRevenue: sql<string>`COALESCE((
        SELECT SUM(${campaignBookings.bookedAmount}) FROM ${campaignBookings}
        WHERE ${campaignBookings.campaignId} = ${eventCampaigns.id}
          AND ${campaignBookings.status} NOT IN ('cancelled', 'refunded')
      ), 0)::text`,
      eligibleRevenue: sql<string>`COALESCE((
        SELECT SUM(${campaignBookings.eligibleRevenue}) FROM ${campaignBookings}
        WHERE ${campaignBookings.campaignId} = ${eventCampaigns.id}
      ), 0)::text`,
      feeAmount: sql<string>`COALESCE((
        SELECT SUM(${campaignBookings.feeAmount}) FROM ${campaignBookings}
        WHERE ${campaignBookings.campaignId} = ${eventCampaigns.id}
      ), 0)::text`,
    })
    .from(eventCampaigns)
    .where(eq(eventCampaigns.restaurantId, restaurant.id))
    .orderBy(sql`${eventCampaigns.eventDate} DESC`);

  return <CampaignsDashboard restaurantName={restaurant.name} campaigns={campaigns} />;
}

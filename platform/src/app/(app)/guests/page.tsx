import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import GuestsTable from './GuestsTable';

export default async function GuestsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  // Show guests who have at least one visit at THIS restaurant — scoping by
  // guests.restaurantId would hide guests whose most recent capture was at a
  // sibling location (dedup is brand-wide). The aggregates here are per-location:
  // visit_count/last_visit only count rows from this restaurant's visits.
  const rows = await db
    .select({
      id: guests.id,
      name: guests.name,
      whatsapp: guests.whatsapp,
      birthdayMmdd: guests.birthdayMmdd,
      preferences: guests.preferences,
      marketingConsent: guests.marketingConsent,
      status: guests.status,
      validationCode: guests.validationCode,
      redemptionType: guests.redemptionType,
      promoType: guests.promoType,
      capturedAt: guests.capturedAt,
      validatedAt: guests.validatedAt,
      notes: guests.notes,
      visitCount: sql<number>`count(${guestVisits.id})`.mapWith(Number).as('visit_count'),
      lastVisit: sql<Date | null>`max(${guestVisits.visitDate})`.as('last_visit'),
    })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(eq(guestVisits.restaurantId, restaurant.id))
    .groupBy(guests.id)
    .orderBy(desc(guests.capturedAt));

  const initialGuests = rows.map((r) => ({
    ...r,
    capturedAt: r.capturedAt.toISOString(),
    validatedAt: r.validatedAt?.toISOString() ?? null,
    lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
  }));

  return (
    <GuestsTable
      guests={initialGuests}
      restaurantName={restaurant.name}
      brand={restaurant.brand ?? ''}
      slug={session.slug}
    />
  );
}

import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import VipList from './VipList';

// Current month in Mexico City as zero-padded "MM", to match the "MM" tail of
// how guest captures store birthday_mmdd ("DD/MM"). Kept local so this route
// carries no dependency on shared tz helpers.
function currentMonthMexico(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    month: '2-digit',
  }).format(new Date());
}

export const metadata: Metadata = {
  title: 'Club VIP · Cena Maridaje — RateTap',
  robots: 'noindex',
};

const LEON_SLUG = 'estancia-leon';

export default async function VipVinoPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  // gm sessions from other locations don't get León guest PII.
  if (session.role === 'gm' && session.slug !== LEON_SLUG) redirect('/dashboard');

  const restaurant = await getRestaurantBySlug(LEON_SLUG);
  if (!restaurant) redirect('/login');

  const rows = await db
    .select({
      id: guests.id,
      name: guests.name,
      whatsapp: guests.whatsapp,
      birthdayMmdd: guests.birthdayMmdd,
      preferences: guests.preferences,
      marketingConsent: guests.marketingConsent,
      redemptionType: guests.redemptionType,
      promoType: guests.promoType,
      visitCount: sql<number>`count(${guestVisits.id})`.mapWith(Number).as('visit_count'),
      lastVisit: sql<Date | null>`max(${guestVisits.visitDate})`.as('last_visit'),
    })
    .from(guests)
    .leftJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    // LFPDPPP: outreach list carries only guests who opted into marketing.
    .where(and(eq(guests.restaurantId, restaurant.id), eq(guests.marketingConsent, true)))
    .groupBy(guests.id)
    .orderBy(desc(sql`count(${guestVisits.id})`));

  const list = rows.map((r) => ({
    id: r.id,
    name: r.name,
    whatsapp: r.whatsapp,
    birthdayMmdd: r.birthdayMmdd,
    preferences: r.preferences ?? [],
    marketingConsent: r.marketingConsent,
    redemptionType: r.redemptionType,
    promoType: r.promoType,
    visitCount: r.visitCount,
    lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
  }));

  // "DD/MM" → "MM": guests whose birthday falls in the current Mexico-City month.
  const currentMonthMm = currentMonthMexico();

  return <VipList guests={list} currentMonthMm={currentMonthMm} />;
}

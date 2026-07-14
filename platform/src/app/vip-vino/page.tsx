import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { todayBirthdayKeyMexico } from '@/lib/mexico-tz';
import VipList from './VipList';

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
    .where(eq(guests.restaurantId, restaurant.id))
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
  const currentMonthMm = todayBirthdayKeyMexico().slice(3);

  return <VipList guests={list} currentMonthMm={currentMonthMm} />;
}

import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits, staff } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { todayBirthdayKeyMexico } from '@/lib/mexico-tz';
import GuestsTable, { type Filter } from './GuestsTable';

const VALID_FILTERS: Filter[] = ['all', 'today', 'birthdays', 'absent60', 'vip'];

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const todayMmdd = todayBirthdayKeyMexico();
  const { filter: filterParam } = await searchParams;
  const initialFilter = VALID_FILTERS.includes(filterParam as Filter)
    ? (filterParam as Filter)
    : undefined;

  // Run all three queries in parallel to minimise latency.
  const [rows, metricsResult, leaderboardResult] = await Promise.all([
    // All guests who have at least one visit at THIS restaurant.
    db
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
      .orderBy(desc(guests.capturedAt)),

    // Aggregate metrics: active staff count + earliest capture timestamp.
    db
      .select({
        activeStaff: sql<number>`count(distinct ${guests.validatedBy})`.mapWith(Number),
        firstCapture: sql<string | null>`min(${guests.capturedAt})`,
      })
      .from(guests)
      .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
      .where(eq(guestVisits.restaurantId, restaurant.id)),

    // Leaderboard: top 3 staff by validations at this restaurant.
    db
      .select({
        name: staff.name,
        count: sql<number>`count(${guests.id})`.mapWith(Number),
      })
      .from(guests)
      .innerJoin(staff, eq(staff.id, guests.validatedBy))
      .where(
        and(
          eq(staff.restaurantId, restaurant.id),
          eq(guests.status, 'validated'),
        ),
      )
      .groupBy(staff.id, staff.name)
      .orderBy(desc(sql`count(${guests.id})`))
      .limit(3),
  ]);

  const initialGuests = rows.map((r) => ({
    ...r,
    capturedAt: r.capturedAt.toISOString(),
    validatedAt: r.validatedAt?.toISOString() ?? null,
    lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
  }));

  const metricsRow = metricsResult[0];
  const hoursInOperation = metricsRow?.firstCapture
    ? Math.round(
        (Date.now() - new Date(metricsRow.firstCapture).getTime()) / (1000 * 60 * 60),
      )
    : 0;

  const metrics = {
    total: rows.length,
    validated: rows.filter((r) => r.status === 'validated').length,
    copaVino: rows.filter((r) => r.redemptionType === 'copa_vino').length,
    postre: rows.filter((r) => r.redemptionType === 'postre').length,
    otro: rows.filter((r) => r.redemptionType === 'otro').length,
    activeStaff: metricsRow?.activeStaff ?? 0,
    hoursInOperation,
    leaderboard: leaderboardResult.map((r) => ({ name: r.name, count: r.count })),
  };

  return (
    <GuestsTable
      guests={initialGuests}
      restaurantName={restaurant.name}
      brand={restaurant.brand ?? ''}
      slug={session.slug}
      metrics={metrics}
      todayMmdd={todayMmdd}
      initialFilter={initialFilter}
    />
  );
}

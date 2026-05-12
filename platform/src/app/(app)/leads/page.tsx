import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { db } from '@/db';
import { eventLeads } from '@/db/schema';
import LeadsTable from './LeadsTable';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owner/regional get a multi-location lead view post-demo.
  if (session.role === 'owner' || session.role === 'regional') {
    redirect('/overview');
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const rows = await db
    .select()
    .from(eventLeads)
    .where(eq(eventLeads.restaurantId, restaurant.id))
    .orderBy(desc(eventLeads.createdAt));

  // Server-computed metrics for the hero banner — keeps the client component
  // focused on UI. Day boundary uses Mexico City wall-clock.
  const now = new Date();
  const startOfDayMx = new Date(now);
  startOfDayMx.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const metrics = {
    open: rows.filter((r) => r.claimedAt === null).length,
    week: rows.filter((r) => r.createdAt >= sevenDaysAgo).length,
    claimedToday: rows.filter(
      (r) => r.claimedAt !== null && r.claimedAt >= startOfDayMx,
    ).length,
    total: rows.length,
    urgent: rows.filter((r) => r.urgente && r.claimedAt === null).length,
  };

  const { focus } = await searchParams;
  const focusId = focus ? parseInt(focus, 10) : null;

  return (
    <LeadsTable
      restaurantName={restaurant.name}
      metrics={metrics}
      initial={rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        claimedAt: r.claimedAt?.toISOString() ?? null,
        externalCreatedAt: r.externalCreatedAt?.toISOString() ?? null,
      }))}
      focusId={Number.isFinite(focusId) ? focusId : null}
    />
  );
}

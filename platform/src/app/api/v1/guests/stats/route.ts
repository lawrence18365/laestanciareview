import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

export const runtime = 'nodejs';

export async function GET() {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const [row] = await db
    .select({
      total: sql<number>`count(distinct ${guests.id})`.mapWith(Number),
      validated: sql<number>`count(distinct ${guests.id}) filter (where ${guests.status} = 'validated')`.mapWith(Number),
      copaVino: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'copa_vino')`.mapWith(Number),
      postre: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'postre')`.mapWith(Number),
      otro: sql<number>`count(distinct ${guests.id}) filter (where ${guests.redemptionType} = 'otro')`.mapWith(Number),
      activeStaff: sql<number>`count(distinct ${guests.validatedBy})`.mapWith(Number),
      firstCapture: sql<string | null>`min(${guests.capturedAt})`,
    })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(eq(guestVisits.restaurantId, restaurant.id));

  const hoursInOperation = row?.firstCapture
    ? Math.round((Date.now() - new Date(row.firstCapture).getTime()) / (1000 * 60 * 60))
    : 0;

  return Response.json(
    {
      total: row?.total ?? 0,
      validated: row?.validated ?? 0,
      copaVino: row?.copaVino ?? 0,
      postre: row?.postre ?? 0,
      otro: row?.otro ?? 0,
      activeStaff: row?.activeStaff ?? 0,
      hoursInOperation,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

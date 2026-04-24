import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { guestsToMetaCsv } from '@/lib/guest-csv';

export const runtime = 'nodejs';

export async function GET() {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  // Scope by guest_visits.restaurantId, not guests.restaurantId. Cross-location
  // dedup (same whatsapp + brand) means guests.restaurantId points only to the
  // most recent capture location — export-by-visits keeps this GM's audience
  // stable even after the guest visits another location in the same brand.
  const rows = await db
    .selectDistinct({
      name: guests.name,
      whatsapp: guests.whatsapp,
      capturedAt: guests.capturedAt,
    })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(eq(guestVisits.restaurantId, restaurant.id))
    .orderBy(desc(guests.capturedAt));

  const csv = guestsToMetaCsv(rows);

  const today = new Date().toISOString().slice(0, 10);
  const filename = `invitados-${session.slug}-${today}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

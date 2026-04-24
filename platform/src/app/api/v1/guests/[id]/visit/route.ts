import { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits, staff } from '@/db/schema';
import { guestManualVisitSchema } from '@/lib/validations';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const guestId = Number(id);
  if (!Number.isInteger(guestId) || guestId <= 0) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  // Same authorisation rule as PATCH — GM can log visits for any guest with
  // a prior visit at their restaurant. See the PATCH route for the rationale.
  const authorised = await db
    .select({ id: guests.id })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(
      and(
        eq(guests.id, guestId),
        eq(guestVisits.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!authorised[0]) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsed = guestManualVisitSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let loggedBy: number | null = null;
  if (parsed.data.staffCode) {
    const staffRow = await db
      .select()
      .from(staff)
      .where(
        and(
          eq(staff.restaurantId, restaurant.id),
          sql`lower(${staff.code}) = lower(${parsed.data.staffCode})`,
        ),
      )
      .limit(1);
    loggedBy = staffRow[0]?.id ?? null;
  }

  const inserted = await db
    .insert(guestVisits)
    .values({
      guestId,
      restaurantId: restaurant.id,
      notes: parsed.data.notes,
      loggedBy,
    })
    .returning({ id: guestVisits.id });

  return Response.json({ ok: true, visitId: inserted[0].id });
}

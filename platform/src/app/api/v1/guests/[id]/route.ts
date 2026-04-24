import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { guestUpdateSchema } from '@/lib/validations';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

export const runtime = 'nodejs';

export async function PATCH(
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

  // Authorisation: the GM can edit any guest who has ≥1 visit at their
  // restaurant. Filtering on guests.restaurantId alone would lock the GM out
  // of guests whose most recent capture was at a sibling brand location.
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
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = guestUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Partial<typeof guests.$inferInsert> = {};
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.preferences !== undefined) patch.preferences = parsed.data.preferences;
  if (parsed.data.marketingConsent !== undefined) patch.marketingConsent = parsed.data.marketingConsent;

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: true, unchanged: true });
  }

  await db.update(guests).set(patch).where(eq(guests.id, guestId));
  return Response.json({ ok: true });
}

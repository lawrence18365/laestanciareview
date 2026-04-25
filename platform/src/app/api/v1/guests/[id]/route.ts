import { NextRequest } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits } from '@/db/schema';
import { guestUpdateSchema } from '@/lib/validations';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { normaliseMexicanPhone } from '@/lib/phone';

export const runtime = 'nodejs';

async function authoriseGuestForSession(
  guestId: number,
  restaurantId: number,
): Promise<boolean> {
  // GMs can manage any guest who has ≥1 visit at their restaurant. Filtering
  // on guests.restaurantId alone would lock a GM out of guests whose most
  // recent capture happened at a sibling brand location.
  const rows = await db
    .select({ id: guests.id })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(
      and(eq(guests.id, guestId), eq(guestVisits.restaurantId, restaurantId)),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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

  if (!(await authoriseGuestForSession(guestId, restaurant.id))) {
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
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.birthdayMmdd !== undefined) patch.birthdayMmdd = parsed.data.birthdayMmdd;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.preferences !== undefined) patch.preferences = parsed.data.preferences;
  if (parsed.data.marketingConsent !== undefined) patch.marketingConsent = parsed.data.marketingConsent;

  // WhatsApp is part of the (whatsapp, brand) dedup key. Re-normalise the new
  // value and reject if it would collide with another guest in the same brand.
  if (parsed.data.whatsapp !== undefined) {
    const normalised = normaliseMexicanPhone(parsed.data.whatsapp);
    const [current] = await db
      .select({ brand: guests.brand, whatsapp: guests.whatsapp })
      .from(guests)
      .where(eq(guests.id, guestId))
      .limit(1);
    if (!current) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    if (normalised !== current.whatsapp) {
      const collision = await db
        .select({ id: guests.id })
        .from(guests)
        .where(
          and(
            eq(guests.whatsapp, normalised),
            eq(guests.brand, current.brand),
            ne(guests.id, guestId),
          ),
        )
        .limit(1);
      if (collision[0]) {
        return Response.json(
          { error: 'Otro invitado ya usa ese WhatsApp en esta marca' },
          { status: 409 },
        );
      }
      patch.whatsapp = normalised;
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: true, unchanged: true });
  }

  await db.update(guests).set(patch).where(eq(guests.id, guestId));
  return Response.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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

  if (!(await authoriseGuestForSession(guestId, restaurant.id))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // guestVisits.guestId has ON DELETE CASCADE in the schema, so removing the
  // guest row removes the audit trail of visits as well.
  await db.delete(guests).where(eq(guests.id, guestId));
  return Response.json({ ok: true });
}

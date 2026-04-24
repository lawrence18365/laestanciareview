import { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits, restaurants, staff } from '@/db/schema';
import { guestValidateSchema } from '@/lib/validations';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  // Higher than capture because a single tablet legitimately fires many per hour.
  const ipLimit = await checkRateLimitAsync(`guest-validate-ip:${ip}`, 60, 60_000);
  if (!ipLimit.allowed) return rateLimitResponse(ipLimit.resetAt);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = guestValidateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const restaurantRow = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, input.restaurantSlug))
    .limit(1);
  const restaurant = restaurantRow[0];
  if (!restaurant) return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });

  const staffRow = await db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.restaurantId, restaurant.id),
        sql`lower(${staff.code}) = lower(${input.staffCode})`,
      ),
    )
    .limit(1);
  const staffMember = staffRow[0];
  if (!staffMember) return Response.json({ error: 'Personal no encontrado' }, { status: 404 });

  // Code is unique-ish per restaurant while pending. Match on the combination
  // and only if still pending_validation; already-validated codes return 409.
  const guestRow = await db
    .select()
    .from(guests)
    .where(
      and(
        eq(guests.restaurantId, restaurant.id),
        eq(guests.validationCode, input.code),
      ),
    )
    .limit(1);
  const guest = guestRow[0];

  if (!guest) return Response.json({ error: 'Código no encontrado' }, { status: 404 });
  if (guest.status === 'validated') {
    return Response.json({ error: 'Este código ya fue validado' }, { status: 409 });
  }
  if (guest.status === 'expired') {
    return Response.json({ error: 'Este código expiró' }, { status: 409 });
  }

  const now = new Date();
  await db
    .update(guests)
    .set({
      status: 'validated',
      validatedAt: now,
      validatedBy: staffMember.id,
      redemptionType: input.redemptionType,
      notes: input.notes ? [guest.notes, input.notes].filter(Boolean).join('\n').slice(0, 2000) : guest.notes,
    })
    .where(eq(guests.id, guest.id));

  // Visits are 1-per-arrival: the capture endpoint already inserted a row.
  // On validation, upgrade that pending row with staff attribution instead of
  // inserting a second row (which would double the visit count).
  const recent = await db
    .select({ id: guestVisits.id })
    .from(guestVisits)
    .where(eq(guestVisits.guestId, guest.id))
    .orderBy(desc(guestVisits.visitDate))
    .limit(1);
  if (recent[0]) {
    await db
      .update(guestVisits)
      .set({ loggedBy: staffMember.id, notes: input.notes ?? null })
      .where(eq(guestVisits.id, recent[0].id));
  } else {
    // Defensive: if no capture visit exists (shouldn't happen), create one.
    await db.insert(guestVisits).values({
      guestId: guest.id,
      restaurantId: restaurant.id,
      loggedBy: staffMember.id,
      notes: input.notes,
    });
  }

  return Response.json({
    ok: true,
    guestName: guest.name,
    guestWhatsapp: guest.whatsapp,
    redemptionType: input.redemptionType,
    validatedAt: now.toISOString(),
  });
}

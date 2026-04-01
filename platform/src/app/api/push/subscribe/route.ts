import { NextRequest } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { endpoint, keys } = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: 'Suscripción inválida' }, { status: 400 });
  }

  // Upsert: if this endpoint already exists, update it
  await db
    .insert(pushSubscriptions)
    .values({
      restaurantId: restaurant.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        restaurantId: restaurant.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { endpoint } = body as { endpoint?: string };
  if (!endpoint) {
    return Response.json({ error: 'Endpoint requerido' }, { status: 400 });
  }

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.restaurantId, restaurant.id),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );

  return Response.json({ ok: true });
}

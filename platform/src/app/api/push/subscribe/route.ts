import { NextRequest } from 'next/server';
import { db } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import {
  classifyPushDevice,
  type PushDisplayMode,
} from '@/lib/push-device';

export async function GET(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'No autorizado' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });
  }

  const endpoint = req.nextUrl.searchParams.get('endpoint');
  if (!endpoint || endpoint.length > 1024) {
    return Response.json({ error: 'Endpoint requerido' }, { status: 400 });
  }

  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.restaurantId, restaurant.id),
        eq(pushSubscriptions.endpoint, endpoint),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .limit(1);

  return Response.json({ active: rows.length > 0 });
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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

  const { endpoint, keys, display_mode: displayMode } = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    display_mode?: PushDisplayMode;
  };

  if (
    !endpoint || typeof endpoint !== 'string' || endpoint.length > 1024 ||
    !keys?.p256dh || typeof keys.p256dh !== 'string' || keys.p256dh.length > 256 ||
    !keys?.auth || typeof keys.auth !== 'string' || keys.auth.length > 64 ||
    (displayMode !== undefined && displayMode !== 'browser' && displayMode !== 'standalone')
  ) {
    return Response.json({ error: 'Suscripción inválida' }, { status: 400 });
  }

  const rawUserAgent = req.headers.get('user-agent');
  const userAgent = rawUserAgent?.slice(0, 400) || null;
  const deviceKind = classifyPushDevice(rawUserAgent, displayMode);

  // Upsert: if this endpoint already exists, update it
  await db
    .insert(pushSubscriptions)
    .values({
      restaurantId: restaurant.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      role: session.role,
      deviceKind,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        restaurantId: restaurant.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        role: session.role,
        deviceKind,
        userAgent,
        revokedAt: null,
        revokedReason: null,
        lastSubscribedAt: sql`now()`,
        resubscribeCount: sql`${pushSubscriptions.resubscribeCount} + 1`,
      },
    });

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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

  const { endpoint, reason } = body as {
    endpoint?: string;
    reason?: 'user_unsubscribe' | 'permission_revoked';
  };
  if (!endpoint || typeof endpoint !== 'string' || endpoint.length > 1024) {
    return Response.json({ error: 'Endpoint requerido' }, { status: 400 });
  }
  if (
    reason !== undefined &&
    reason !== 'user_unsubscribe' &&
    reason !== 'permission_revoked'
  ) {
    return Response.json({ error: 'Motivo inválido' }, { status: 400 });
  }

  const revokedReason = reason ?? 'user_unsubscribe';

  await db
    .update(pushSubscriptions)
    .set({
      revokedAt: sql`now()`,
      revokedReason,
    })
    .where(
      and(
        eq(pushSubscriptions.restaurantId, restaurant.id),
        eq(pushSubscriptions.endpoint, endpoint),
        isNull(pushSubscriptions.revokedAt),
      ),
    );

  return Response.json({ ok: true });
}

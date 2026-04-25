import { NextRequest } from 'next/server';
import { getRestaurantBySlug } from '@/lib/queries';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';

// 5 login attempts per minute per IP
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  try {
    const ip = getClientIP(req);
    const rl = await checkRateLimitAsync(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    let parsed: { slug?: unknown; password?: unknown };
    try {
      parsed = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { slug, password } = parsed;

    if (
      typeof slug !== 'string' ||
      typeof password !== 'string' ||
      !slug ||
      !password ||
      slug.length > 100 ||
      password.length > 256
    ) {
      return Response.json(
        { error: 'Restaurante y contraseña son requeridos' },
        { status: 400 },
      );
    }

    const restaurant = await getRestaurantBySlug(slug);
    if (!restaurant) {
      return Response.json(
        { error: 'Credenciales inválidas' },
        { status: 401 },
      );
    }

    if (!restaurant.adminPasswordHash) {
      return Response.json(
        { error: 'No hay contraseña configurada para este restaurante' },
        { status: 401 },
      );
    }

    const valid = await verifyPassword(password, restaurant.adminPasswordHash);
    if (!valid) {
      return Response.json(
        { error: 'Credenciales inválidas' },
        { status: 401 },
      );
    }

    // Auto-upgrade legacy SHA-256 hashes to PBKDF2 on successful login
    if (!restaurant.adminPasswordHash.includes(':')) {
      const upgraded = await hashPassword(password);
      await db
        .update(restaurants)
        .set({ adminPasswordHash: upgraded })
        .where(eq(restaurants.id, restaurant.id));
    }

    const role = restaurant.isOwner ? 'owner' : restaurant.isRegional ? 'regional' : 'gm';
    await createSession(slug, role, restaurant.isRegional ? (restaurant.region ?? undefined) : undefined);

    return Response.json({ ok: true, slug, role });
  } catch {
    return Response.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

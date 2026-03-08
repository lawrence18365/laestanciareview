import { NextRequest } from 'next/server';
import { verifyResetToken } from '@/lib/reset-token';
import { hashPassword } from '@/lib/auth';
import { getRestaurantBySlug } from '@/lib/queries';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// 5 attempts per 15 minutes per IP
const LIMIT = 5;
const WINDOW = 15 * 60_000;

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`reset-pw:${ip}`, LIMIT, WINDOW);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { token, password } = body;

  if (!token || !password) {
    return Response.json(
      { error: 'Token y contraseña son requeridos' },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return Response.json(
      { error: 'La contraseña debe tener al menos 8 caracteres' },
      { status: 400 },
    );
  }

  const slug = await verifyResetToken(token);
  if (!slug) {
    return Response.json(
      { error: 'Enlace invalido o expirado. Solicita uno nuevo.' },
      { status: 400 },
    );
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json(
      { error: 'Restaurante no encontrado' },
      { status: 404 },
    );
  }

  const hashed = await hashPassword(password);
  await db
    .update(restaurants)
    .set({ adminPasswordHash: hashed })
    .where(eq(restaurants.id, restaurant.id));

  return Response.json({ ok: true });
}

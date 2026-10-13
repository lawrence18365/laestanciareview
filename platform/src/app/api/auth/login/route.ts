import { NextRequest } from 'next/server';
import { findLoginCandidates } from '@/lib/queries';
import { verifyPassword, hashPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { setGroupMarker } from '@/lib/group-device';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';

// 5 login attempts per minute per IP
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW = 60_000;

// Well-formed PBKDF2 hash nobody can match; only used to equalise timing.
const DUMMY_HASH = `${'00'.repeat(16)}:100000:${'00'.repeat(32)}`;

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  try {
    const ip = getClientIP(req);
    const rl = await checkRateLimitAsync(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    let parsed: { identifier?: unknown; slug?: unknown; password?: unknown };
    try {
      parsed = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    // `slug` is the legacy field, kept during the transition.
    const identifier = parsed.identifier ?? parsed.slug;
    const { password } = parsed;

    if (
      typeof identifier !== 'string' ||
      typeof password !== 'string' ||
      !identifier.trim() ||
      !password ||
      identifier.length > 100 ||
      password.length > 256
    ) {
      return Response.json(
        { error: 'Restaurante y contraseña son requeridos' },
        { status: 400 },
      );
    }

    // An identifier may match several accounts (shared email, duplicate name):
    // log in only when exactly one of them accepts the password.
    const candidates = await findLoginCandidates(identifier);
    const matches: typeof candidates = [];
    let checked = 0;
    for (const candidate of candidates) {
      if (!candidate.adminPasswordHash) continue;
      checked++;
      if (await verifyPassword(password, candidate.adminPasswordHash)) matches.push(candidate);
    }
    // Spend the same hashing time when nothing was checked so response timing
    // does not reveal whether the identifier exists.
    if (checked === 0) await verifyPassword(password, DUMMY_HASH);

    if (matches.length !== 1) {
      return Response.json(
        { error: 'Credenciales inválidas' },
        { status: 401 },
      );
    }
    const restaurant = matches[0];
    const slug = restaurant.slug;

    // Auto-upgrade legacy SHA-256 hashes to PBKDF2 on successful login
    if (restaurant.adminPasswordHash && !restaurant.adminPasswordHash.includes(':')) {
      const upgraded = await hashPassword(password);
      await db
        .update(restaurants)
        .set({ adminPasswordHash: upgraded })
        .where(eq(restaurants.id, restaurant.id));
    }

    const role = restaurant.isOwner ? 'owner' : restaurant.isRegional ? 'regional' : 'gm';
    await createSession(slug, role, restaurant.isRegional ? (restaurant.region ?? undefined) : undefined);
    // A group account marks this device as known, so /login keeps its dropdown.
    if (restaurant.groupKey) await setGroupMarker(restaurant.groupKey);

    return Response.json({ ok: true, slug, role });
  } catch {
    return Response.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

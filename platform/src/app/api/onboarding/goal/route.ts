import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { canAskGoal, SIGNUP_GOALS } from '@/lib/onboarding-profile';
import { recordProductEvent } from '@/lib/product-events';

export const dynamic = 'force-dynamic';

// Unknown keys (e.g. a slug or restaurant id) are stripped, never honored: the
// target restaurant is always the session's own.
const bodySchema = z.object({ goal: z.enum(SIGNUP_GOALS) });

/**
 * POST /api/onboarding/goal — the optional "¿Qué quieres lograr?" answer.
 *
 * Merges `{ goal }` into the session restaurant's `google_profile` jsonb (no
 * migration) and records `signup_goal_selected`. Answer once: a second answer
 * is a 409 and changes nothing. Self-serve only (group_key NULL, team_mode set);
 * Grupo Estancia locations are refused.
 */
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  // Owner / regional sessions span several restaurants: no single target.
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'Invalid goal' }, { status: 400 });
  const { goal } = parsed.data;

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!canAskGoal(restaurant)) return Response.json({ error: 'Not available' }, { status: 403 });
  if (goal === 'team_asks' && restaurant.teamMode !== 'team') {
    return Response.json({ error: 'Invalid goal' }, { status: 400 });
  }

  const current = sql`(case when jsonb_typeof(${restaurants.googleProfile}) = 'object' then ${restaurants.googleProfile} else '{}'::jsonb end)`;
  const updated = await db
    .update(restaurants)
    .set({ googleProfile: sql`${current} || ${JSON.stringify({ goal })}::jsonb` })
    .where(and(eq(restaurants.id, restaurant.id), sql`${current} -> 'goal' is null`))
    .returning({ id: restaurants.id });

  if (updated.length === 0) {
    return Response.json({ error: 'Already answered' }, { status: 409 });
  }

  await recordProductEvent({
    name: 'signup_goal_selected',
    restaurantId: restaurant.id,
    role: session.role,
    path: '/bienvenida',
    properties: { goal },
  });

  return Response.json({ ok: true, goal });
}

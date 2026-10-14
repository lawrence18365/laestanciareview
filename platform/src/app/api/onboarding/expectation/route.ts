import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { productEvents } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { canAskGoal } from '@/lib/onboarding-profile';
import { recordProductEvent } from '@/lib/product-events';

export const dynamic = 'force-dynamic';

// Unknown keys (e.g. a slug or restaurant id) are stripped, never honored: the
// target restaurant is always the session's own.
const bodySchema = z.object({ text: z.string().trim().min(1).max(280) });

/**
 * POST /api/onboarding/expectation — the optional "¿Qué esperabas lograr?"
 * answer shown after a goal chip.
 *
 * Records `signup_expectation` with `{ text }`. No migration, no google_profile
 * change. Answer once per restaurant: a second answer is a 409 and records
 * nothing. Self-serve only, same guard as the goal question.
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
  if (!parsed.success) return Response.json({ error: 'Invalid text' }, { status: 400 });
  const { text } = parsed.data;

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!canAskGoal(restaurant)) return Response.json({ error: 'Not available' }, { status: 403 });

  const [existing] = await db
    .select({ id: productEvents.id })
    .from(productEvents)
    .where(and(eq(productEvents.restaurantId, restaurant.id), eq(productEvents.eventName, 'signup_expectation')))
    .limit(1);
  if (existing) return Response.json({ error: 'Already answered' }, { status: 409 });

  await recordProductEvent({
    name: 'signup_expectation',
    restaurantId: restaurant.id,
    role: session.role,
    path: '/bienvenida',
    properties: { text },
  });

  return Response.json({ ok: true });
}

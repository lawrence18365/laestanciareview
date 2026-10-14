import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { canAskGoal } from '@/lib/onboarding-profile';
import { getMapsRankSummary } from '@/lib/maps-rank';
import { mapsCardFor } from '@/app/bienvenida/ready-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding/maps-card — the "Tu lugar en Google Maps" numbers for
 * the /bienvenida ready screen. The signup status endpoint stops being callable
 * once the account is ready (its one-time cookie is deleted), so the card polls
 * this one with the session instead.
 *
 * Own restaurant only (session slug), self-serve solo/team only. Returns
 * `{ card: null }` until the signup sweep has written its samples, and
 * `{ card: null, done: true }` when no card will ever come. Reads the stored
 * summary only: no Places calls, no competitor data.
 */
export async function GET() {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.MAPS_RANK_ENABLED !== 'true') {
    return Response.json({ card: null, done: true });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant || !canAskGoal(restaurant)) {
    return Response.json({ card: null, done: true });
  }

  try {
    const card = mapsCardFor(await getMapsRankSummary(restaurant.id));
    return Response.json({ card });
  } catch {
    return Response.json({ card: null });
  }
}

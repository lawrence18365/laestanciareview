import { db } from '@/db';
import { reviews } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

/** PATCH: Update a feedback item's status (new → reviewed → resolved). */
export async function PATCH(req: Request) {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const { reviewId, status } = body as { reviewId?: number; status?: string };

  if (!reviewId || typeof status !== 'string' || !['new', 'reviewed', 'resolved'].includes(status)) {
    return Response.json({ error: 'Invalid reviewId or status' }, { status: 400 });
  }

  const [updated] = await db
    .update(reviews)
    .set({ status: status as 'new' | 'reviewed' | 'resolved' })
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.restaurantId, restaurant.id),
      ),
    )
    .returning();

  if (!updated) {
    return Response.json({ error: 'Review not found' }, { status: 404 });
  }

  return Response.json({ ok: true, status: updated.status });
}

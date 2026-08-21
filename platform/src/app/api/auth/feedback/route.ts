import { db } from '@/db';
import { reviews } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { sessionFeedbackPatchSchema } from '@/lib/validations';
import { requireSameOrigin } from '@/lib/origin';

/** PATCH: Update a feedback item's status (new → reviewed → resolved). */
export async function PATCH(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = sessionFeedbackPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Status timestamps power review-resolution funnel metrics. reviewedAt is
  // set on the first transition out of 'new' and never overwritten (COALESCE
  // keeps the original); resolvedAt is set whenever the review reaches
  // 'resolved'.
  const now = new Date();
  const status = parsed.data.status;
  const reviewedAtPatch =
    status === 'reviewed' || status === 'resolved'
      ? sql`COALESCE(${reviews.reviewedAt}, ${now})`
      : undefined;
  const resolvedAtPatch = status === 'resolved' ? now : undefined;

  const [updated] = await db
    .update(reviews)
    .set({
      status,
      ...(reviewedAtPatch ? { reviewedAt: reviewedAtPatch } : {}),
      ...(resolvedAtPatch ? { resolvedAt: resolvedAtPatch } : {}),
    })
    .where(
      and(
        eq(reviews.id, parsed.data.reviewId),
        eq(reviews.restaurantId, restaurant.id),
      ),
    )
    .returning();

  if (!updated) {
    return Response.json({ error: 'Review not found' }, { status: 404 });
  }

  return Response.json({ ok: true, status: updated.status });
}

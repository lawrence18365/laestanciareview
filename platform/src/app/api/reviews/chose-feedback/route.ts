/**
 * Records that a guest chose private feedback (as opposed to a public Google
 * review). The guest is offered both options equally after tapping a star —
 * this endpoint fires when they pick private feedback. Read-only: it only
 * authenticates the caller via the opaque feedbackToken minted at star-tap
 * and does not mutate the review row.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { requireSameOrigin } from '@/lib/origin';
import { tokenHash } from '@/lib/tokens';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

export const runtime = 'nodejs';

const schema = z.object({
  reviewId: z.number().int().positive(),
  feedbackToken: z.string().min(32).max(256),
});

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`chose-feedback:${ip}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const { reviewId, feedbackToken } = parsed.data;
  const feedbackTokenHash = await tokenHash(feedbackToken);

  const [review] = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      staffCode: reviews.staffCode,
    })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.feedbackTokenHash, feedbackTokenHash)))
    .limit(1);

  if (!review) {
    return Response.json({ error: 'Review not found' }, { status: 404 });
  }

  try {
    await trackCommercialEvent({
      eventName: 'review_chose_feedback',
      restaurantId: review.restaurantId,
      source: 'review_flow',
      path: '/r',
      metadata: {
        review_id: review.id,
        rating: review.rating,
        staff_code: review.staffCode ?? null,
        ui_variant: 'hierarchy_v2',
      },
    });
  } catch (err) {
    console.error('[reviews/chose-feedback] commercial event failed:', err);
  }

  return Response.json({ ok: true });
}

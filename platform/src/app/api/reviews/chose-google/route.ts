/**
 * Records that a guest chose to leave a public Google review (as opposed to
 * private feedback). The guest is offered both options equally after tapping a
 * star — this endpoint fires when they pick Google, so sent_to_google reflects
 * the guest's ACTUAL choice, not their rating. Token-authed like the feedback
 * route: the opaque feedbackToken minted at star-tap binds the caller to the
 * review.
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
  const rl = await checkRateLimitAsync(`chose-google:${ip}`, 30, 60_000);
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

  const [updated] = await db
    .update(reviews)
    .set({ sentToGoogle: true })
    .where(and(eq(reviews.id, reviewId), eq(reviews.feedbackTokenHash, feedbackTokenHash)))
    .returning({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      staffCode: reviews.staffCode,
    });

  if (!updated) {
    return Response.json({ error: 'Review not found' }, { status: 404 });
  }

  try {
    await trackCommercialEvent({
      eventName: 'google_redirected',
      restaurantId: updated.restaurantId,
      source: 'review_flow',
      path: '/r',
      metadata: {
        review_id: updated.id,
        rating: updated.rating,
        staff_code: updated.staffCode ?? null,
      },
    });
  } catch (err) {
    console.error('[reviews/chose-google] commercial event failed:', err);
  }

  return Response.json({ ok: true });
}

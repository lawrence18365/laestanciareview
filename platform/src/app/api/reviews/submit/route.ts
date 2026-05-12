import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { submitReviewSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { randomToken, tokenHash } from '@/lib/tokens';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

// 30 reviews per minute per IP (generous for busy restaurants with shared tablet)
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`submit:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = submitReviewSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { restaurantSlug, staffCode, rating } = parsed.data;

  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  const staffMember = await getStaffByCode(restaurant.id, staffCode);

  const sentToGoogle =
    rating >= restaurant.googleThreshold && !!restaurant.googleReviewUrl;
  const feedbackToken = randomToken();
  const feedbackTokenHash = await tokenHash(feedbackToken);

  const [review] = await db
    .insert(reviews)
    .values({
      restaurantId: restaurant.id,
      staffId: staffMember?.id ?? null,
      staffCode,
      staffName: staffMember?.name ?? staffCode,
      rating,
      feedbackTokenHash,
      sentToGoogle,
    })
    .returning();

  // Alerts are fired only when the customer actually submits feedback (see
  // /api/reviews/feedback). Tapping a star alone is not enough signal — too many
  // customers open the form and abandon, which used to flood GM inboxes with
  // placeholder "(sin comentario aún)" alerts.

  let googleReviewUrl: string | null = null;
  if (sentToGoogle && restaurant.googleReviewUrl) {
    try {
      const u = new URL(restaurant.googleReviewUrl);
      u.searchParams.set('utm_source', 'ratetap');
      u.searchParams.set('utm_medium', 'nfc');
      u.searchParams.set('utm_campaign', restaurantSlug);
      u.searchParams.set('utm_content', staffCode || 'no-card');
      googleReviewUrl = u.toString();
    } catch {
      googleReviewUrl = restaurant.googleReviewUrl;
    }
  }

  try {
    await trackCommercialEvent({
      eventName: 'review_submitted',
      restaurantId: restaurant.id,
      source: 'review_flow',
      path: `/r/${restaurantSlug}`,
      metadata: {
        review_id: review.id,
        rating,
        staff_code: staffCode || null,
        sent_to_google: sentToGoogle,
      },
    });

    if (sentToGoogle) {
      await trackCommercialEvent({
        eventName: 'google_redirected',
        restaurantId: restaurant.id,
        source: 'review_flow',
        path: `/r/${restaurantSlug}`,
        metadata: {
          review_id: review.id,
          rating,
          staff_code: staffCode || null,
        },
      });
    }
  } catch (err) {
    console.error('[reviews/submit] commercial event failed:', err);
  }

  return Response.json({
    reviewId: review.id,
    feedbackToken,
    action: sentToGoogle ? 'google' : 'feedback',
    googleReviewUrl,
  });
}

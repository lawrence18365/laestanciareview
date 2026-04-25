import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { submitReviewSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';

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

  const [review] = await db
    .insert(reviews)
    .values({
      restaurantId: restaurant.id,
      staffId: staffMember?.id ?? null,
      staffCode,
      staffName: staffMember?.name ?? staffCode,
      rating,
      sentToGoogle,
    })
    .returning();

  // Alerts are fired only when the customer actually submits feedback (see
  // /api/reviews/feedback). Tapping a star alone is not enough signal — too many
  // customers open the form and abandon, which used to flood GM inboxes with
  // placeholder "(sin comentario aún)" alerts.

  return Response.json({
    reviewId: review.id,
    action: sentToGoogle ? 'google' : 'feedback',
    googleReviewUrl: sentToGoogle ? restaurant.googleReviewUrl : null,
  });
}

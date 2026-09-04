import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { submitReviewSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { randomToken, tokenHash } from '@/lib/tokens';
import { trackCommercialEvent } from '@/lib/commercial-tracking';
import { normalizeStaffCode } from '@/lib/staff-code';

// 30 reviews per minute per IP (generous for busy restaurants with shared tablet)
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW = 60_000;
const DEVICE_REVIEW_LIMIT = 3;
const DEVICE_REVIEW_WINDOW = 24 * 60 * 60 * 1000;
const REVIEW_DEVICE_SALT_FALLBACK = 'ratetap-review-device-limit-v1';
const REVIEW_DEVICE_COOKIE = 'rt_device';
const REVIEW_DEVICE_COOKIE_MAX_AGE = 31_536_000;

function getReviewDeviceHash(deviceId: string): string {
  const salt = process.env.REVIEW_DEVICE_SALT || REVIEW_DEVICE_SALT_FALLBACK;

  // IP and user agent are intentionally excluded because guests can share both
  // on restaurant Wi-Fi and identical phones.
  return createHash('sha256').update(`${salt}|${deviceId}`).digest('hex');
}

function setReviewDeviceCookie(response: Response, deviceId: string): Response {
  response.headers.append(
    'Set-Cookie',
    `${REVIEW_DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=${REVIEW_DEVICE_COOKIE_MAX_AGE}; SameSite=Lax; Secure; HttpOnly`,
  );
  return response;
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const existingDeviceId = req.cookies.get(REVIEW_DEVICE_COOKIE)?.value;
  const deviceId = existingDeviceId || randomUUID();
  const deviceHash = getReviewDeviceHash(deviceId);
  const respond = (response: Response) =>
    existingDeviceId ? response : setReviewDeviceCookie(response, deviceId);

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`submit:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW);
  if (!rl.allowed) return respond(rateLimitResponse(rl.resetAt));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond(Response.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
  const parsed = submitReviewSchema.safeParse(body);

  if (!parsed.success) {
    return respond(
      Response.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      ),
    );
  }

  const { restaurantSlug, staffCode, rating } = parsed.data;
  const normalizedStaffCode = normalizeStaffCode(staffCode);

  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) {
    return respond(Response.json({ error: 'Restaurant not found' }, { status: 404 }));
  }

  if (existingDeviceId) {
    const reviewWindowStart = new Date(Date.now() - DEVICE_REVIEW_WINDOW);
    const [deviceReviewCount] = await db
      .select({ count: count() })
      .from(reviews)
      .where(
        and(
          eq(reviews.restaurantId, restaurant.id),
          eq(reviews.deviceHash, deviceHash),
          gte(reviews.createdAt, reviewWindowStart),
        ),
      );

    if (Number(deviceReviewCount?.count ?? 0) >= DEVICE_REVIEW_LIMIT) {
      return respond(Response.json({ ok: true, limited: true }));
    }
  }

  const staffMember = await getStaffByCode(restaurant.id, normalizedStaffCode);

  // Compliant flow: capture the rating for internal analytics + waiter
  // attribution, but do NOT route the guest by it. Every guest is offered the
  // same two options (Google review OR private feedback) and chooses. The
  // Google link is built for everyone; sent_to_google is recorded only when the
  // guest actually chooses Google (see /api/reviews/chose-google).
  const feedbackToken = randomToken();
  const feedbackTokenHash = await tokenHash(feedbackToken);

  const [review] = await db
    .insert(reviews)
    .values({
      restaurantId: restaurant.id,
      staffId: staffMember?.id ?? null,
      staffCode: normalizedStaffCode,
      staffName: staffMember?.name ?? normalizedStaffCode,
      rating,
      feedbackTokenHash,
      deviceHash,
      sentToGoogle: false,
    })
    .returning();

  // Alerts are fired only when the customer actually submits feedback (see
  // /api/reviews/feedback). Tapping a star alone is not enough signal.

  // Google review link: offered to EVERY guest, regardless of rating.
  let googleReviewUrl: string | null = null;
  if (restaurant.googleReviewUrl) {
    try {
      const u = new URL(restaurant.googleReviewUrl);
      u.searchParams.set('utm_source', 'ratetap');
      u.searchParams.set('utm_medium', 'nfc');
      u.searchParams.set('utm_campaign', restaurantSlug);
      u.searchParams.set('utm_content', normalizedStaffCode || 'no-card');
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
        staff_code: normalizedStaffCode || null,
        ui_variant: 'hierarchy_v2',
      },
    });
  } catch (err) {
    console.error('[reviews/submit] commercial event failed:', err);
  }

  return respond(
    Response.json({
      reviewId: review.id,
      feedbackToken,
      action: 'choice',
      googleReviewUrl,
    }),
  );
}

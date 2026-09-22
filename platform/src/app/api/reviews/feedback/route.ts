import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews, restaurants } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { submitFeedbackSchema } from '@/lib/validations';
import { dispatchFeedbackAlerts } from '@/lib/feedback-alerts';
import { scheduleComplaintSlaSweep } from '@/lib/complaint-sla';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { tokenHash } from '@/lib/tokens';
import { trackCommercialEvent } from '@/lib/commercial-tracking';

// 10 feedback submissions per minute per IP
const FEEDBACK_LIMIT = 10;
const FEEDBACK_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`feedback:${ip}`, FEEDBACK_LIMIT, FEEDBACK_WINDOW);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = submitFeedbackSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { reviewId, feedbackToken, customerName, customerEmail, feedback } = parsed.data;
  const feedbackTokenHash = await tokenHash(feedbackToken);

  // Only allow updating reviews that don't already have feedback
  // The opaque token binds this public form to the review created by the star tap.
  // The `feedback IS NULL` clause is what makes this atomic under a concurrent
  // double submit: the second UPDATE re-evaluates its WHERE while waiting on the
  // row lock and matches nothing.
  const [updated] = await db
    .update(reviews)
    .set({
      customerName: customerName ?? null,
      customerEmail: customerEmail ?? null,
      feedback,
    })
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.feedbackTokenHash, feedbackTokenHash),
        isNull(reviews.feedback),
      ),
    )
    .returning();

  if (!updated) {
    // No row moved. Either this guest already submitted, or the id/token pair
    // matched nothing at all — the two look identical here, so they are told
    // apart by the same lookup the UPDATE used (id AND token hash, never the id
    // alone). A correct-token retry is a SUCCESS for the guest: their feedback
    // is already stored, so the double tap / retry after a dropped response /
    // second tab gets the same success shape. What it must NOT do is replay the
    // first write's side effects — the alert dispatch, the commercial event and
    // the SLA sweep all belong to the write that actually happened, and the
    // stored feedback is never overwritten.
    const [existing] = await db
      .select({ id: reviews.id, feedback: reviews.feedback })
      .from(reviews)
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.feedbackTokenHash, feedbackTokenHash),
        ),
      )
      .limit(1);

    if (existing?.feedback) {
      return Response.json({ success: true, reviewId: existing.id });
    }

    // Missing review, or a token that does not belong to it: still non-success.
    return Response.json({ error: 'Review not found or feedback already submitted' }, { status: 404 });
  }

  // Alerts are fired only on feedback submission (not on bare star taps).
  const [restaurant] = await db
    .select({
      name: restaurants.name,
      managerEmail: restaurants.managerEmail,
      managerPhone: restaurants.managerPhone,
      alertPreference: restaurants.alertPreference,
      smsAlerts: restaurants.smsAlerts,
      whatsappAlerts: restaurants.whatsappAlerts,
      googleThreshold: restaurants.googleThreshold,
      region: restaurants.region,
    })
    .from(restaurants)
    .where(eq(restaurants.id, updated.restaurantId))
    .limit(1);

  if (restaurant) {
    await dispatchFeedbackAlerts(updated, restaurant);
  }

  try {
    await trackCommercialEvent({
      eventName: 'feedback_submitted',
      restaurantId: updated.restaurantId,
      source: 'review_flow',
      path: '/feedback',
      metadata: {
        review_id: updated.id,
        rating: updated.rating,
        staff_code: updated.staffCode ?? null,
        has_customer_email: Boolean(updated.customerEmail),
      },
    });
  } catch (err) {
    console.error('[reviews/feedback] commercial event failed:', err);
  }

  // The response value is settled: the guest's submission is committed and the
  // GM has been dispatched to. Only now kick off the fire-and-forget sweep.
  const payload = { success: true, reviewId: updated.id };
  scheduleComplaintSlaSweep();

  return Response.json(payload);
}

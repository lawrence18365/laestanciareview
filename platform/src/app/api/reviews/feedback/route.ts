import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews, restaurants } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { submitFeedbackSchema } from '@/lib/validations';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { sendWhatsAppAlert } from '@/lib/whatsapp';
import { sendPushToRestaurant } from '@/lib/push';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';
import { tokenHash } from '@/lib/tokens';
import { trackCommercialEvent } from '@/lib/commercial-tracking';
import { isPositiveRating } from '@/lib/feedback';

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
    })
    .from(restaurants)
    .where(eq(restaurants.id, updated.restaurantId))
    .limit(1);

  if (restaurant) {
    const pref = restaurant.alertPreference ?? 'all';
    let shouldSend = false;

    if (pref === 'all') shouldSend = true;
    else if (pref === 'low') shouldSend = updated.rating <= 2;
    else if (pref === 'threshold') shouldSend = updated.rating < restaurant.googleThreshold;
    // pref === 'off' -> shouldSend stays false

    if (shouldSend) {
      const errors: string[] = [];
      const alerts: Promise<void>[] = [];

      if (restaurant.managerEmail) {
        alerts.push(
          sendFeedbackAlert({
            to: restaurant.managerEmail,
            restaurantName: restaurant.name,
            customerName: updated.customerName,
            customerEmail: updated.customerEmail,
            rating: updated.rating,
            staffName: updated.staffName,
            feedback: feedback,
          }).then((result) => {
            if (result.success === false) {
              const responseCode = result.error?.responseCode != null
                ? ` SMTP ${result.error.responseCode}`
                : '';
              errors.push(`email${responseCode}: ${result.error?.message ?? 'send skipped'}`);
            }
          }).catch((err) => { errors.push(`email: ${err?.message ?? err}`); }),
        );
      }

      if (restaurant.smsAlerts && restaurant.managerPhone) {
        alerts.push(
          sendSMSAlert({
            to: restaurant.managerPhone,
            restaurantName: restaurant.name,
            customerName: updated.customerName,
            rating: updated.rating,
            staffName: updated.staffName,
            feedback: feedback,
          }).catch((err) => { errors.push(`sms: ${err?.message ?? err}`); }),
        );
      }

      if (restaurant.whatsappAlerts && restaurant.managerPhone) {
        alerts.push(
          sendWhatsAppAlert({
            to: restaurant.managerPhone,
            restaurantName: restaurant.name,
            customerName: updated.customerName,
            rating: updated.rating,
            staffName: updated.staffName,
            feedback: feedback,
          }).catch((err) => { errors.push(`whatsapp: ${err?.message ?? err}`); }),
        );
      }

      alerts.push(
        sendPushToRestaurant(updated.restaurantId, {
          title: isPositiveRating(updated.rating)
            ? `⭐ Comentario positivo de ${updated.rating} estrellas`
            : `⚠️ Reseña de ${updated.rating} estrella${updated.rating === 1 ? '' : 's'}`,
          body: feedback.length > 100 ? feedback.slice(0, 100) + '…' : feedback,
          url: '/inbox',
          tag: `review-${updated.id}`,
        }).then(() => {}).catch((err) => { errors.push(`push: ${err?.message ?? err}`); }),
      );

      await Promise.all(alerts);

      await db.update(reviews).set({
        alertSentAt: errors.length === 0 && alerts.length > 0 ? new Date() : null,
        alertError: errors.length > 0 ? errors.join('; ') : null,
      }).where(eq(reviews.id, updated.id));

      if (errors.length > 0) {
        console.error(`[alert] Review #${updated.id} feedback alert errors: ${errors.join('; ')}`);
      }
    }
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

  return Response.json({ success: true, reviewId: updated.id });
}

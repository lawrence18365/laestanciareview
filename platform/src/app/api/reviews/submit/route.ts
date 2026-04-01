import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { submitReviewSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { sendWhatsAppAlert } from '@/lib/whatsapp';
import { sendPushToRestaurant } from '@/lib/push';

// 30 reviews per minute per IP (generous for busy restaurants with shared tablet)
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW = 60_000;

export async function POST(req: NextRequest) {
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

  // Send alert on negative ratings (this is the single alert per review)
  if (!sentToGoogle) {
    const pref = restaurant.alertPreference ?? 'all';
    let shouldSend = false;

    if (pref === 'all') shouldSend = true;
    else if (pref === 'low') shouldSend = rating <= 2;
    else if (pref === 'threshold') shouldSend = rating < restaurant.googleThreshold;

    if (shouldSend) {
      const alertParams = {
        restaurantName: restaurant.name,
        customerName: null as string | null,
        rating,
        staffName: review.staffName,
        feedback: '(sin comentario aún — el cliente está en el formulario)',
      };

      const errors: string[] = [];

      const alerts: Promise<void>[] = [];

      if (restaurant.managerEmail) {
        alerts.push(
          sendFeedbackAlert({ to: restaurant.managerEmail, customerEmail: null, ...alertParams })
            .catch((err) => { errors.push(`email: ${err?.message ?? err}`); }),
        );
      }
      if (restaurant.smsAlerts && restaurant.managerPhone) {
        alerts.push(
          sendSMSAlert({ to: restaurant.managerPhone, ...alertParams })
            .catch((err) => { errors.push(`sms: ${err?.message ?? err}`); }),
        );
      }
      if (restaurant.whatsappAlerts && restaurant.managerPhone) {
        alerts.push(
          sendWhatsAppAlert({ to: restaurant.managerPhone, ...alertParams })
            .catch((err) => { errors.push(`whatsapp: ${err?.message ?? err}`); }),
        );
      }

      // Push notification — instant alert on GM's phone
      alerts.push(
        sendPushToRestaurant(restaurant.id, {
          title: `⚠️ Reseña de ${rating} estrella${rating === 1 ? '' : 's'}`,
          body: `${review.staffName} — ${restaurant.name}`,
          url: '/inbox',
          tag: `review-${review.id}`,
        }).then(() => {}).catch((err) => { errors.push(`push: ${err?.message ?? err}`); }),
      );

      await Promise.all(alerts);

      // Record alert outcome on the review
      await db.update(reviews).set({
        alertSentAt: errors.length === 0 && alerts.length > 0 ? new Date() : null,
        alertError: errors.length > 0 ? errors.join('; ') : null,
      }).where(eq(reviews.id, review.id));

      if (errors.length > 0) {
        console.error(`[alert] Review #${review.id} (${restaurant.name}) alert errors: ${errors.join('; ')}`);
      }
    }
  }

  return Response.json({
    reviewId: review.id,
    action: sentToGoogle ? 'google' : 'feedback',
    googleReviewUrl: sentToGoogle ? restaurant.googleReviewUrl : null,
  });
}

import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews } from '@/db/schema';
import { submitReviewSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { sendWhatsAppAlert } from '@/lib/whatsapp';

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

  // Instant alert on negative ratings (don't wait for feedback form)
  if (!sentToGoogle) {
    const pref = restaurant.alertPreference ?? 'all';
    let shouldSend = false;

    if (pref === 'all') shouldSend = true;
    else if (pref === 'low') shouldSend = rating <= 2;
    else if (pref === 'threshold') shouldSend = rating < restaurant.googleThreshold;

    if (shouldSend) {
      const placeholderFeedback = '(sin comentario aún — el cliente está en el formulario)';
      const alertParams = {
        restaurantName: restaurant.name,
        customerName: null as string | null,
        rating,
        staffName: review.staffName,
        feedback: placeholderFeedback,
      };

      const alerts: Promise<void>[] = [];

      if (restaurant.managerEmail) {
        alerts.push(
          sendFeedbackAlert({ to: restaurant.managerEmail, customerEmail: null, ...alertParams })
            .catch((err) => console.error('[email] Failed to send instant alert:', err)),
        );
      }
      if (restaurant.smsAlerts && restaurant.managerPhone) {
        alerts.push(
          sendSMSAlert({ to: restaurant.managerPhone, ...alertParams })
            .catch((err) => console.error('[sms] Failed to send instant alert:', err)),
        );
      }
      if (restaurant.whatsappAlerts && restaurant.managerPhone && restaurant.callmebotApiKey) {
        alerts.push(
          sendWhatsAppAlert({ to: restaurant.managerPhone, apiKey: restaurant.callmebotApiKey, ...alertParams })
            .catch((err) => console.error('[whatsapp] Failed to send instant alert:', err)),
        );
      }

      await Promise.all(alerts);
    }
  }

  return Response.json({
    reviewId: review.id,
    action: sentToGoogle ? 'google' : 'feedback',
    googleReviewUrl: sentToGoogle ? restaurant.googleReviewUrl : null,
  });
}

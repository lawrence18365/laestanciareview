import { NextRequest } from 'next/server';
import { db } from '@/db';
import { reviews, restaurants } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { submitFeedbackSchema } from '@/lib/validations';
import { sendFeedbackAlert } from '@/lib/email';
import { sendSMSAlert } from '@/lib/sms';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// 10 feedback submissions per minute per IP
const FEEDBACK_LIMIT = 10;
const FEEDBACK_WINDOW = 60_000;

export async function POST(req: NextRequest) {
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

  const { reviewId, customerName, customerEmail, feedback } = parsed.data;

  // Only allow updating reviews that don't already have feedback
  // This prevents overwriting another customer's feedback
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
        isNull(reviews.feedback),
      ),
    )
    .returning();

  if (!updated) {
    return Response.json({ error: 'Review not found or feedback already submitted' }, { status: 404 });
  }

  // Send email alert to GM (non-blocking), respecting alert preference
  const [restaurant] = await db
    .select({
      name: restaurants.name,
      managerEmail: restaurants.managerEmail,
      managerPhone: restaurants.managerPhone,
      alertPreference: restaurants.alertPreference,
      smsAlerts: restaurants.smsAlerts,
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
      const alerts: Promise<void>[] = [];

      // Email alert
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
          }).catch((err) => console.error('[email] Failed to send alert:', err)),
        );
      }

      // SMS alert
      if (restaurant.smsAlerts && restaurant.managerPhone) {
        alerts.push(
          sendSMSAlert({
            to: restaurant.managerPhone,
            restaurantName: restaurant.name,
            customerName: updated.customerName,
            rating: updated.rating,
            staffName: updated.staffName,
            feedback: feedback,
          }).catch((err) => console.error('[sms] Failed to send alert:', err)),
        );
      }

      // Await alerts so serverless function doesn't terminate early
      await Promise.all(alerts);
    }
  }

  return Response.json({ success: true, reviewId: updated.id });
}

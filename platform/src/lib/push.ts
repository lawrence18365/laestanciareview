import webpush from 'web-push';
import { db } from '@/db';
import { pushNotifications, pushSubscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';

let pushConfigured: boolean | null = null;

function ensurePushConfigured(): boolean {
  if (pushConfigured !== null) return pushConfigured;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not configured, skipping push');
    pushConfigured = false;
    return pushConfigured;
  }

  try {
    webpush.setVapidDetails(
      'mailto:soporte@ratetap.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
    );
    pushConfigured = true;
  } catch (error) {
    console.error('[push] Invalid VAPID configuration, disabling push notifications', error);
    pushConfigured = false;
  }

  return pushConfigured;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushMeta {
  kind: string;
  subjectType?: string;
  subjectId?: number;
}

/**
 * Append push-attribution params to a notification URL so app_open/page_view
 * can be joined back to the push_notifications row that caused the session.
 * Handles URLs that already carry a query string.
 */
export function withPushTracking(url: string, nid: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}src=push&nid=${nid}`;
}

/**
 * Send push notifications to all subscribers for a restaurant.
 * Automatically removes stale/expired subscriptions.
 *
 * Every send is recorded in push_notifications: one row per logical
 * notification with subscriptions_targeted and, after the fan-out,
 * accepted_count / failed_count. "accepted" honestly means the push SERVICE
 * returned 2xx — it is NOT confirmation the device displayed the notification.
 */
export async function sendPushToRestaurant(
  restaurantId: number,
  payload: PushPayload,
  meta?: PushMeta,
): Promise<{ sent: number; failed: number }> {
  if (!ensurePushConfigured()) {
    return { sent: 0, failed: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.restaurantId, restaurantId));

  const url = payload.url ?? '/dashboard';

  // Insert the attribution row BEFORE sending so the nid can travel inside
  // the payload URL the device opens on click. Analytics must never block a
  // push: if the insert fails we send without nid/src tracking.
  let notificationId: number | null = null;
  try {
    const [notification] = await db
      .insert(pushNotifications)
      .values({
        restaurantId,
        kind: meta?.kind ?? 'generic',
        subjectType: meta?.subjectType ?? null,
        subjectId: meta?.subjectId ?? null,
        url,
        subscriptionsTargeted: subs.length,
      })
      .returning({ id: pushNotifications.id });
    notificationId = notification.id;
  } catch (err) {
    console.warn('[push] analytics insert failed, sending without tracking:', err);
  }

  if (subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify({
    ...payload,
    url: notificationId !== null ? withPushTracking(url, notificationId) : url,
    ...(notificationId !== null ? { nid: notificationId } : {}),
    kind: meta?.kind ?? 'generic',
  });
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        // 404 or 410 means the subscription is no longer valid
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
        }
        failed++;
      }
    }),
  );

  if (notificationId !== null) {
    try {
      await db
        .update(pushNotifications)
        .set({ acceptedCount: sent, failedCount: failed })
        .where(eq(pushNotifications.id, notificationId));
    } catch (err) {
      console.warn('[push] analytics update failed:', err);
    }
  }

  return { sent, failed };
}

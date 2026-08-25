import { z } from 'zod';
import { db } from '@/db';
import { productEvents } from '@/db/schema';

/**
 * Product Analytics V1 — first-party event capture.
 *
 * Every event name in the system. The client-side tracker (analytics-client.ts)
 * and server pages both write into the single `product_events` table.
 */
export const PRODUCT_EVENT_NAMES = [
  'app_open',
  'page_view',
  'push_notification_click',
  'push_permission_result',
  'push_banner_shown',
  'push_banner_suppressed',
  'push_banner_dismissed',
  'push_subscribe_click',
  'push_subscribe_failed',
  'push_permission_revoked_detected',
  'push_subscription_healed',
  'review_page_open',
  'guest_capture_page_open',
  'validation_page_open',
  'staff_scoreboard_open',
  'guest_profile_opened',
  'guest_filter_changed',
  'guest_whatsapp_link_click',
  'feedback_email_reply_click',
  'csv_export',
  'mesero_qr_generated',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/**
 * Events that may be recorded without an authenticated session (public guest
 * surfaces: QR review page, guest capture, validation tablet, mesero card, and
 * service-worker push callbacks). Anything else from an anonymous caller is
 * dropped silently by the track endpoint.
 */
export const PUBLIC_EVENT_NAMES: readonly ProductEventName[] = [
  'review_page_open',
  'guest_capture_page_open',
  'validation_page_open',
  'staff_scoreboard_open',
  'push_notification_click',
  'push_permission_result',
];

export interface ProductEventInput {
  name: ProductEventName;
  restaurantId?: number | null;
  role?: string | null;
  staffId?: number | null;
  sessionId?: string | null;
  path?: string | null;
  displayMode?: string | null;
  properties?: Record<string, unknown>;
}

/**
 * Insert one event. NEVER throws — analytics must never break the product
 * surface it measures. Failures are logged as warnings.
 */
export async function recordProductEvent(input: ProductEventInput): Promise<void> {
  try {
    await db.insert(productEvents).values({
      eventName: input.name,
      restaurantId: input.restaurantId ?? null,
      role: input.role ?? null,
      staffId: input.staffId ?? null,
      sessionId: input.sessionId ?? null,
      path: input.path ?? null,
      displayMode: input.displayMode ?? null,
      properties: input.properties ?? {},
    });
  } catch (err) {
    console.warn(`[analytics] failed to record ${input.name}:`, err);
  }
}

/** Batch variant — one INSERT for many rows. Also never throws. */
export async function recordProductEvents(inputs: ProductEventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await db.insert(productEvents).values(
      inputs.map((input) => ({
        eventName: input.name,
        restaurantId: input.restaurantId ?? null,
        role: input.role ?? null,
        staffId: input.staffId ?? null,
        sessionId: input.sessionId ?? null,
        path: input.path ?? null,
        displayMode: input.displayMode ?? null,
        properties: input.properties ?? {},
      })),
    );
  } catch (err) {
    console.warn(`[analytics] failed to record batch of ${inputs.length}:`, err);
  }
}

/**
 * Payload accepted by POST /api/analytics/track. Bounded hard: max 20 events
 * per request, short strings only, free-form properties capped separately
 * (2 KB of JSON) by the route handler.
 */
export const trackBatchSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(PRODUCT_EVENT_NAMES),
        path: z.string().max(300).optional(),
        display_mode: z.enum(['browser', 'standalone']).optional(),
        session_id: z.string().max(64).optional(),
        restaurant_slug: z.string().max(100).optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(20),
});

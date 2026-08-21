import { NextRequest } from 'next/server';
import { requireSameOrigin } from '@/lib/origin';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import {
  PUBLIC_EVENT_NAMES,
  recordProductEvents,
  trackBatchSchema,
  type ProductEventInput,
} from '@/lib/product-events';

export const dynamic = 'force-dynamic';

/** Properties payloads are capped at 2 KB of JSON — enough for attribution
 *  metadata, too small to become a storage-abuse vector. */
const MAX_PROPERTIES_BYTES = 2048;

function capProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!properties) return {};
  try {
    const json = JSON.stringify(properties);
    if (json.length <= MAX_PROPERTIES_BYTES) return properties;
    return { truncated: true };
  } catch {
    // Non-serializable values (shouldn't happen post-Zod, but be safe).
    return {};
  }
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  // Generous ceiling: a single dashboard session can legitimately fire several
  // events per minute; 120/min/IP bounds abuse without touching real usage.
  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`analytics-track:${ip}`, 120, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  // This endpoint is intentionally "always 204": analytics must never surface
  // errors to the client, and bad input must never produce a 5xx.
  try {
    const body = await req.json();
    const parsed = trackBatchSchema.safeParse(body);
    if (!parsed.success) return new Response(null, { status: 204 });

    const session = await verifySession();

    let sessionRestaurantId: number | null = null;
    if (session) {
      const restaurant = await getRestaurantBySlug(session.slug);
      sessionRestaurantId = restaurant?.id ?? null;
    }

    // Resolve slugs carried by anonymous/public events (public pages include
    // the slug so guest events land on the right restaurant).
    const slugCache = new Map<string, number | null>();
    async function restaurantIdForSlug(slug: string): Promise<number | null> {
      if (!slugCache.has(slug)) {
        const r = await getRestaurantBySlug(slug);
        slugCache.set(slug, r?.id ?? null);
      }
      return slugCache.get(slug) ?? null;
    }

    const publicNames = new Set<string>(PUBLIC_EVENT_NAMES);
    const inputs: ProductEventInput[] = [];

    for (const event of parsed.data.events) {
      if (session) {
        inputs.push({
          name: event.name,
          restaurantId: sessionRestaurantId,
          role: session.role,
          sessionId: event.session_id ?? null,
          path: event.path ?? null,
          displayMode: event.display_mode ?? null,
          properties: capProperties(event.properties),
        });
      } else {
        // Anonymous caller: only allow-listed public events, recorded as
        // 'guest'. Everything else is dropped silently.
        if (!publicNames.has(event.name)) continue;
        inputs.push({
          name: event.name,
          restaurantId: event.restaurant_slug
            ? await restaurantIdForSlug(event.restaurant_slug)
            : null,
          role: 'guest',
          sessionId: event.session_id ?? null,
          path: event.path ?? null,
          displayMode: event.display_mode ?? null,
          properties: capProperties(event.properties),
        });
      }
    }

    await recordProductEvents(inputs);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.warn('[analytics/track] bad request swallowed:', err);
    return new Response(null, { status: 204 });
  }
}

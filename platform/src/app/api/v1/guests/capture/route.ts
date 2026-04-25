import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { guests, guestVisits, restaurants } from '@/db/schema';
import { guestCaptureSchema } from '@/lib/validations';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { sendLeadEvent } from '@/lib/meta-conversions';
import { normaliseMexicanPhone } from '@/lib/phone';
import { requireSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';

const VALIDATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;

// Full 10k-code space (0000-9999). At ~50 pending codes/restaurant, collision
// probability on a new capture is ~0.5% — acceptable for MVP scale.
function generateValidationCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 10000).padStart(4, '0');
}

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const ip = getClientIP(req);
  const ipLimit = await checkRateLimitAsync(`guest-capture-ip:${ip}`, 5, 60_000);
  if (!ipLimit.allowed) return rateLimitResponse(ipLimit.resetAt);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = guestCaptureSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const restaurantRow = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, input.restaurantSlug))
    .limit(1);
  const restaurant = restaurantRow[0];
  if (!restaurant) {
    return Response.json({ error: 'Restaurante no encontrado' }, { status: 404 });
  }
  // brand is nullable on restaurants (owner/regional rows) but required for guest capture.
  if (!restaurant.brand) {
    return Response.json({ error: 'Restaurante sin marca configurada' }, { status: 409 });
  }
  const brand = restaurant.brand;

  const whatsapp = normaliseMexicanPhone(input.whatsapp);
  // Second limit layer: per-WhatsApp per-brand. Restaurant wifi + mobile NAT
  // share IPs on a busy night; IP-only would false-positive legitimate guests.
  const waLimit = await checkRateLimitAsync(
    `guest-capture-wa:${brand}:${whatsapp}`,
    3,
    24 * 60 * 60 * 1000,
  );
  if (!waLimit.allowed) return rateLimitResponse(waLimit.resetAt);

  const validationCode = generateValidationCode();
  const validationCodeExpiresAt = new Date(Date.now() + VALIDATION_CODE_TTL_MS);

  // UPSERT on the (whatsapp, brand) unique constraint. This collapses the
  // previous SELECT-then-branch race window into a single atomic operation.
  const upserted = await db
    .insert(guests)
    .values({
      restaurantId: restaurant.id,
      brand,
      name: input.name,
      whatsapp,
      birthdayMmdd: input.birthdayMmdd,
      preferences: input.preferences,
      marketingConsent: input.marketingConsent,
      validationCode,
      validationCodeExpiresAt,
      promoType: input.promoType,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
    })
    .onConflictDoUpdate({
      target: [guests.whatsapp, guests.brand],
      set: {
        name: input.name,
        birthdayMmdd: input.birthdayMmdd,
        preferences: input.preferences ?? undefined,
        // Marketing consent is monotonic — once granted, never revoked silently.
        marketingConsent: input.marketingConsent || undefined,
        validationCode,
        validationCodeExpiresAt,
        status: 'pending_validation',
        validatedAt: null,
        validatedBy: null,
        redemptionType: null,
        promoType: input.promoType ?? null,
        restaurantId: restaurant.id,
        utmSource: input.utmSource ?? undefined,
        utmMedium: input.utmMedium ?? undefined,
        utmCampaign: input.utmCampaign ?? undefined,
      },
    })
    .returning({ id: guests.id, capturedAt: guests.capturedAt });

  const guestId = upserted[0].id;
  // capturedAt is set by `defaultNow()` on insert; with onConflictDoUpdate it
  // returns the existing row's timestamp, so a row whose captured_at differs
  // from "now" (allowing a small skew) was not freshly inserted.
  const isNew =
    Math.abs(Date.now() - new Date(upserted[0].capturedAt).getTime()) < 5_000;

  // Always log a visit row so per-visit counts match per-capture counts.
  await db.insert(guestVisits).values({
    guestId,
    restaurantId: restaurant.id,
  });

  // Lead CAPI — shared eventId with client-side fbq('track','Lead',...,{eventID}).
  const eventId = `guest-${guestId}-${Date.now()}`;
  try {
    await sendLeadEvent({
      phone: whatsapp,
      eventId,
      custom: {
        brand_slug: brand,
        location_slug: restaurant.slug,
        promo_type: input.promoType ?? null,
      },
    });
  } catch (err) {
    console.error('[guest-capture] Lead CAPI failed:', err);
  }

  return Response.json({
    ok: true,
    validationCode,
    eventId,
    isNew,
  });
}


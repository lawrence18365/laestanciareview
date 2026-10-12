import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getRestaurantLogoHash } from '@/lib/queries';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { refreshGoogleRating } from '@/lib/google-places';
import { getBrandForRestaurant } from '@/lib/brands';
import { derivedGoogleReviewUrl } from '@/lib/google-review';
import { requireSameOrigin } from '@/lib/origin';

/**
 * An uploaded logo, as a data URL. Only the three formats the browser is told
 * to produce are accepted, and only up to 280 KB of base64 text — the client
 * rejects anything over 200 KB of image bytes, so this is the backstop.
 */
const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LOGO_DATA_URL_MAX_LENGTH = 280_000;

/**
 * The custom logo's URL, or null when the restaurant has none.
 *
 * The data URL itself never leaves the server as a response field: it is up to
 * 280 KB and the settings screen only needs to show it. /api/logo/[slug] serves
 * the bytes, versioned by `logoHash` — the md5 prefix of the data URL, which is
 * all any caller ever sees of the image.
 */
function logoUrlFor(restaurant: { slug: string; logoHash: string | null }) {
  return restaurant.logoHash ? getBrandForRestaurant(restaurant).logo : null;
}

export async function GET() {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({
    name: restaurant.name,
    slug: restaurant.slug,
    googleReviewUrl: restaurant.googleReviewUrl,
    googleThreshold: restaurant.googleThreshold,
    managerEmail: restaurant.managerEmail,
    managerPhone: restaurant.managerPhone,
    alertPreference: restaurant.alertPreference,
    smsAlerts: restaurant.smsAlerts,
    whatsappAlerts: restaurant.whatsappAlerts,
    callmebotApiKey: restaurant.callmebotApiKey,
    googlePlaceId: restaurant.googlePlaceId,
    googleRating: restaurant.googleRating ? parseFloat(restaurant.googleRating) : null,
    googleReviewCount: restaurant.googleReviewCount,
    logoUrl: logoUrlFor(restaurant),
  });
}

export async function PATCH(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.googleReviewUrl === 'string') {
    updates.googleReviewUrl = body.googleReviewUrl || null;
  }
  if (typeof body.googleThreshold === 'number' && body.googleThreshold >= 1 && body.googleThreshold <= 5) {
    updates.googleThreshold = body.googleThreshold;
  }
  if (typeof body.managerEmail === 'string') {
    updates.managerEmail = body.managerEmail || null;
  }
  if (typeof body.managerPhone === 'string') {
    let phone = body.managerPhone || null;
    // Strip old Mexican mobile "1" prefix: +521XXXXXXXXXX → +52XXXXXXXXXX
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 13 && digits.startsWith('521')) {
        phone = '+52' + digits.slice(3);
      }
    }
    updates.managerPhone = phone;
  }
  if (typeof body.smsAlerts === 'boolean') {
    updates.smsAlerts = body.smsAlerts;
  }
  if (typeof body.whatsappAlerts === 'boolean') {
    updates.whatsappAlerts = body.whatsappAlerts;
  }
  if (typeof body.callmebotApiKey === 'string') {
    updates.callmebotApiKey = body.callmebotApiKey || null;
  }
  if (typeof body.alertPreference === 'string' && ['all', 'low', 'threshold', 'off'].includes(body.alertPreference)) {
    updates.alertPreference = body.alertPreference;
  }
  if (typeof body.googlePlaceId === 'string') {
    updates.googlePlaceId = body.googlePlaceId || null;
    // Auto-derive review URL from place ID when no URL is set yet and none is being explicitly provided
    if (body.googlePlaceId && !restaurant.googleReviewUrl && typeof body.googleReviewUrl !== 'string') {
      updates.googleReviewUrl = derivedGoogleReviewUrl(body.googlePlaceId);
    }
  }

  // Logo upload. `null` removes it; anything else must be one of the three
  // formats the browser encoder produces, within the size the column allows.
  // Rejected loudly rather than dropped: a silently ignored logo upload looks
  // like a save that worked.
  if (body.logoDataUrl !== undefined) {
    if (body.logoDataUrl === null) {
      updates.logoDataUrl = null;
    } else if (
      typeof body.logoDataUrl === 'string' &&
      body.logoDataUrl.length <= LOGO_DATA_URL_MAX_LENGTH &&
      LOGO_DATA_URL_PATTERN.test(body.logoDataUrl)
    ) {
      updates.logoDataUrl = body.logoDataUrl;
    } else {
      return Response.json({ error: 'Logo inválido' }, { status: 400 });
    }
  }
  if (typeof body.newPassword === 'string' && body.newPassword.length >= 8) {
    // Require current password verification before allowing a change
    if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
      return Response.json({ error: 'Contraseña actual requerida' }, { status: 400 });
    }
    if (!restaurant.adminPasswordHash) {
      return Response.json({ error: 'No se encontró contraseña existente' }, { status: 400 });
    }
    const isValid = await verifyPassword(body.currentPassword, restaurant.adminPasswordHash);
    if (!isValid) {
      return Response.json({ error: 'Contraseña actual incorrecta' }, { status: 403 });
    }
    updates.adminPasswordHash = await hashPassword(body.newPassword);
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Only the fields the response actually returns come back from Postgres —
  // in particular not `logo_data_url`, which is up to 280 KB.
  const [updated] = await db
    .update(restaurants)
    .set(updates)
    .where(eq(restaurants.id, restaurant.id))
    .returning({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      googleReviewUrl: restaurants.googleReviewUrl,
      googleThreshold: restaurants.googleThreshold,
      managerEmail: restaurants.managerEmail,
      managerPhone: restaurants.managerPhone,
      alertPreference: restaurants.alertPreference,
      smsAlerts: restaurants.smsAlerts,
      whatsappAlerts: restaurants.whatsappAlerts,
      callmebotApiKey: restaurants.callmebotApiKey,
      googlePlaceId: restaurants.googlePlaceId,
      googleRating: restaurants.googleRating,
      googleReviewCount: restaurants.googleReviewCount,
    });

  // The logo's version tag is read with its own single-column query
  // (md5(logo_data_url) inside Postgres) so the image itself never travels
  // back to the app just to build a URL.
  const logoHash = await getRestaurantLogoHash(updated.id);

  // If a Place ID was just set for the first time, immediately capture
  // the baseline rating. This is the "pre-RateTap" score - day 1.
  // Cost: 1 Google API call, only happens once per restaurant.
  if (
    typeof body.googlePlaceId === 'string' &&
    body.googlePlaceId &&
    body.googlePlaceId !== restaurant.googlePlaceId
  ) {
    refreshGoogleRating(updated.id, body.googlePlaceId, 0).catch(() => {});
  }

  return Response.json({
    name: updated.name,
    slug: updated.slug,
    googleReviewUrl: updated.googleReviewUrl,
    googleThreshold: updated.googleThreshold,
    managerEmail: updated.managerEmail,
    managerPhone: updated.managerPhone,
    alertPreference: updated.alertPreference,
    smsAlerts: updated.smsAlerts,
    whatsappAlerts: updated.whatsappAlerts,
    callmebotApiKey: updated.callmebotApiKey,
    googlePlaceId: updated.googlePlaceId,
    googleRating: updated.googleRating ? parseFloat(updated.googleRating) : null,
    googleReviewCount: updated.googleReviewCount,
    logoUrl: logoUrlFor({ slug: updated.slug, logoHash }),
  });
}

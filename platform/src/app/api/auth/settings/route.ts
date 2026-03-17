import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { refreshGoogleRating } from '@/lib/google-places';

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
    googlePlaceId: restaurant.googlePlaceId,
    googleRating: restaurant.googleRating ? parseFloat(restaurant.googleRating) : null,
    googleReviewCount: restaurant.googleReviewCount,
  });
}

export async function PATCH(req: Request) {
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
  if (typeof body.alertPreference === 'string' && ['all', 'low', 'threshold', 'off'].includes(body.alertPreference)) {
    updates.alertPreference = body.alertPreference;
  }
  if (typeof body.googlePlaceId === 'string') {
    updates.googlePlaceId = body.googlePlaceId || null;
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

  const [updated] = await db
    .update(restaurants)
    .set(updates)
    .where(eq(restaurants.id, restaurant.id))
    .returning();

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
    googlePlaceId: updated.googlePlaceId,
    googleRating: updated.googleRating ? parseFloat(updated.googleRating) : null,
    googleReviewCount: updated.googleReviewCount,
  });
}

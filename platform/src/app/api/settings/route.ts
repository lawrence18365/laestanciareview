import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdminKey, unauthorizedResponse } from '@/lib/auth';
import { updateSettingsSchema } from '@/lib/validations';
import { getRestaurantBySlug } from '@/lib/queries';

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const slug = req.nextUrl.searchParams.get('restaurant');
  if (!slug) {
    return Response.json(
      { error: 'Missing ?restaurant= parameter' },
      { status: 400 },
    );
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  return Response.json({
    settings: {
      googleReviewUrl: restaurant.googleReviewUrl,
      googleThreshold: restaurant.googleThreshold,
      managerEmail: restaurant.managerEmail,
    },
  });
}

export async function PATCH(req: NextRequest) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const slug = req.nextUrl.searchParams.get('restaurant');
  if (!slug) {
    return Response.json(
      { error: 'Missing ?restaurant= parameter' },
      { status: 400 },
    );
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = updateSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(restaurants)
    .set(parsed.data)
    .where(eq(restaurants.id, restaurant.id))
    .returning();

  return Response.json({
    settings: {
      googleReviewUrl: updated.googleReviewUrl,
      googleThreshold: updated.googleThreshold,
      managerEmail: updated.managerEmail,
    },
  });
}

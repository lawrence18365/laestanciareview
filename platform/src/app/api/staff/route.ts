import { NextRequest } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { requireAdminKey, unauthorizedResponse } from '@/lib/auth';
import { createStaffSchema } from '@/lib/validations';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import { verifySession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get('restaurant');
  if (!slug) {
    return Response.json(
      { error: 'Missing ?restaurant= parameter' },
      { status: 400 },
    );
  }

  if (session.role !== 'owner' && session.slug !== slug) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  const list = await getStaffList(restaurant.id);
  return Response.json({ staff: list });
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const body = await req.json();
  const parsed = createStaffSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { restaurantSlug, code, name } = parsed.data;

  const restaurant = await getRestaurantBySlug(restaurantSlug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  const [created] = await db
    .insert(staff)
    .values({
      restaurantId: restaurant.id,
      code,
      name,
    })
    .returning();

  return Response.json({ staff: created }, { status: 201 });
}

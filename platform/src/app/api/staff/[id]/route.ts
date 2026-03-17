import { NextRequest } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdminKey, unauthorizedResponse } from '@/lib/auth';
import { updateStaffSchema } from '@/lib/validations';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Resolve the restaurant ID from the session, ensuring
 * the request is authorized and scoped to the user's restaurant.
 */
async function getAuthorizedRestaurantId(req: NextRequest): Promise<number | null> {
  if (!requireAdminKey(req)) return null;

  const session = await verifySession();
  if (!session) return null;

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return null;

  return restaurant.id;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const restaurantId = await getAuthorizedRestaurantId(req);
  if (restaurantId === null) return unauthorizedResponse();

  const { id } = await ctx.params;
  const staffId = parseInt(id, 10);
  if (isNaN(staffId)) {
    return Response.json({ error: 'Invalid staff ID' }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateStaffSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(staff)
    .set(parsed.data)
    .where(and(eq(staff.id, staffId), eq(staff.restaurantId, restaurantId)))
    .returning();

  if (!updated) {
    return Response.json({ error: 'Staff not found' }, { status: 404 });
  }

  return Response.json({ staff: updated });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const restaurantId = await getAuthorizedRestaurantId(req);
  if (restaurantId === null) return unauthorizedResponse();

  const { id } = await ctx.params;
  const staffId = parseInt(id, 10);
  if (isNaN(staffId)) {
    return Response.json({ error: 'Invalid staff ID' }, { status: 400 });
  }

  const [deleted] = await db
    .delete(staff)
    .where(and(eq(staff.id, staffId), eq(staff.restaurantId, restaurantId)))
    .returning();

  if (!deleted) {
    return Response.json({ error: 'Staff not found' }, { status: 404 });
  }

  return Response.json({ success: true });
}

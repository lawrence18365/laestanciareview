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
 * Resolve the restaurant ID from the session, ensuring the request is
 * authorized and scoped to the user's restaurant.
 *
 * Only GMs (single-restaurant role) may mutate staff via this endpoint.
 * Owner/regional roles must use the owner-overview tooling so the target
 * restaurant is explicit and auditable; denying them here closes a
 * cross-tenant write path that depended on the owner's own slug never
 * matching a real restaurant.
 */
async function getAuthorizedRestaurantId(req: NextRequest): Promise<number | null> {
  if (!requireAdminKey(req)) return null;

  const session = await verifySession();
  if (!session) return null;
  if (session.role !== 'gm') return null;

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

  // Tenant gate: restaurantId comes from the session, not the request — so the
  // AND on staff.restaurantId blocks any cross-tenant mutation. A GM at
  // restaurant-A passing staffId belonging to restaurant-B returns 0 rows.
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

  // Tenant gate: same as PATCH — the AND on staff.restaurantId is the
  // cross-tenant assertion.
  const [deleted] = await db
    .delete(staff)
    .where(and(eq(staff.id, staffId), eq(staff.restaurantId, restaurantId)))
    .returning();

  if (!deleted) {
    return Response.json({ error: 'Staff not found' }, { status: 404 });
  }

  return Response.json({ success: true });
}

/**
 * Claim an event lead. First-tap-wins: the WHERE claimed_at IS NULL predicate
 * + Postgres row-lock guarantees correctness without a transaction.
 *
 * v1 leaves `claimed_by` null because we don't have per-staff sessions yet —
 * the GM session represents the whole team. When per-staff auth lands, this
 * route reads the staffId off the session and writes it.
 */

import { NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { eventLeads } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const leadId = parseInt(id, 10);
  if (isNaN(leadId)) {
    return Response.json({ error: 'Invalid lead id' }, { status: 400 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  // Tenant gate via WHERE restaurant_id, claim gate via WHERE claimed_at IS NULL.
  const [updated] = await db
    .update(eventLeads)
    .set({ status: 'claimed', claimedAt: new Date() })
    .where(
      and(
        eq(eventLeads.id, leadId),
        eq(eventLeads.restaurantId, restaurant.id),
        isNull(eventLeads.claimedAt),
      ),
    )
    .returning();

  if (!updated) {
    // Either already claimed or doesn't belong to this tenant — both look
    // the same to the caller (don't leak existence of cross-tenant leads).
    return Response.json(
      { error: 'Lead not available' },
      { status: 409 },
    );
  }

  return Response.json({
    lead: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      claimedAt: updated.claimedAt?.toISOString() ?? null,
      externalCreatedAt: updated.externalCreatedAt?.toISOString() ?? null,
    },
  });
}

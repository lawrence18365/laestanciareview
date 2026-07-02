/**
 * Move an event lead through its pipeline: new → claimed → quoted → won | lost.
 * Transitions are validated server-side (illegal jumps rejected) and tenant-
 * scoped. Winning a lead also accepts any quote linked to it (coherence).
 *
 * The dedicated /claim route still handles the atomic first-tap-wins claim;
 * this route covers the rest of the lifecycle.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eventLeads, quotes } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';

const bodySchema = z.object({
  status: z.enum(['new', 'claimed', 'quoted', 'won', 'lost']),
});

// Legal next-states per current state. Forward-only through the funnel, with
// "lost" reachable from any active state and a lost lead reopenable to claimed.
const ALLOWED: Record<string, string[]> = {
  new: ['claimed', 'quoted', 'won', 'lost'],
  claimed: ['quoted', 'won', 'lost'],
  quoted: ['won', 'lost'],
  won: [],
  lost: ['claimed'],
};

function serializeLead(lead: typeof eventLeads.$inferSelect) {
  return {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    claimedAt: lead.claimedAt?.toISOString() ?? null,
    externalCreatedAt: lead.externalCreatedAt?.toISOString() ?? null,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const leadId = parseInt(id, 10);
  if (isNaN(leadId)) {
    return Response.json({ error: 'Invalid lead id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed' }, { status: 400 });
  }
  const next = parsed.data.status;

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  const [lead] = await db
    .select()
    .from(eventLeads)
    .where(and(eq(eventLeads.id, leadId), eq(eventLeads.restaurantId, restaurant.id)))
    .limit(1);
  if (!lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 });
  }

  // Idempotent: setting the current status is a no-op success.
  if (lead.status === next) {
    return Response.json({ lead: serializeLead(lead) });
  }

  const allowedNext = ALLOWED[lead.status] ?? [];
  if (!allowedNext.includes(next)) {
    return Response.json(
      { error: `Illegal transition ${lead.status} → ${next}` },
      { status: 409 },
    );
  }

  const patch: { status: string; claimedAt?: Date } = { status: next };
  // Claiming through this route stamps claimedAt if it wasn't set.
  if (next === 'claimed' && lead.claimedAt === null) patch.claimedAt = new Date();

  const [updated] = await db
    .update(eventLeads)
    .set(patch)
    .where(and(eq(eventLeads.id, leadId), eq(eventLeads.restaurantId, restaurant.id)))
    .returning();

  // Coherence: winning the lead accepts any quote linked to it.
  if (next === 'won') {
    await db
      .update(quotes)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(quotes.leadId, leadId), eq(quotes.restaurantId, restaurant.id)));
  }

  return Response.json({ lead: serializeLead(updated) });
}

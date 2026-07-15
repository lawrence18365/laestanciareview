import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eventCampaigns } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { campaignPatchSchema } from '@/lib/event-campaigns';

export const runtime = 'nodejs';

const ALLOWED: Record<string, string[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['active', 'draft', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const campaignId = Number((await params).id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const parsed = campaignPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed' }, { status: 400 });
  }

  const [campaign] = await db
    .select()
    .from(eventCampaigns)
    .where(
      and(
        eq(eventCampaigns.id, campaignId),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!campaign) return Response.json({ error: 'Not found' }, { status: 404 });
  if (campaign.status === parsed.data.status) return Response.json({ campaign });
  if (!(ALLOWED[campaign.status] ?? []).includes(parsed.data.status)) {
    return Response.json(
      { error: `Illegal transition ${campaign.status} → ${parsed.data.status}` },
      { status: 409 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(eventCampaigns)
    .set({
      status: parsed.data.status,
      updatedAt: now,
      ...(parsed.data.status === 'active' && !campaign.launchedAt ? { launchedAt: now } : {}),
      ...(parsed.data.status === 'completed' ? { completedAt: now } : {}),
    })
    .where(
      and(
        eq(eventCampaigns.id, campaignId),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .returning();

  return Response.json({ campaign: updated });
}

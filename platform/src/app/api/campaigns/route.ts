import { NextRequest } from 'next/server';
import { db } from '@/db';
import { eventCampaigns } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { slugify } from '@/lib/slug';
import { campaignCreateSchema } from '@/lib/event-campaigns';
import { seedCampaignAudience } from '@/lib/campaign-audience';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = campaignCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const slug = slugify(`${input.name}-${input.eventDate}`);

  try {
    const [campaign] = await db
      .insert(eventCampaigns)
      .values({
        restaurantId: restaurant.id,
        slug,
        name: input.name,
        campaignType: input.campaignType,
        audienceRule: input.audienceRule,
        eventDate: input.eventDate,
        eventTime: input.eventTime,
        offerName: input.offerName,
        messageText: input.messageText,
        pricePerPerson: input.pricePerPerson.toFixed(2),
        capacity: input.capacity,
        minimumSeats: input.minimumSeats,
        baselineSeats: input.baselineSeats,
        attributionDays: input.attributionDays,
        feePercent: input.feePercent.toFixed(2),
      })
      .returning();

    const audience = await seedCampaignAudience({
      campaignId: campaign.id,
      restaurantId: restaurant.id,
      audienceRule: input.audienceRule,
    });

    return Response.json({ campaign, audience }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return Response.json(
        { error: 'Ya existe una campaña con este nombre y fecha' },
        { status: 409 },
      );
    }
    throw error;
  }
}

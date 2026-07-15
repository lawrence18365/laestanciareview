import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaignContacts, eventCampaigns, guests } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { requireSameOrigin } from '@/lib/origin';
import { campaignContactPatchSchema, contactTimestamps } from '@/lib/event-campaigns';

export const runtime = 'nodejs';

const ALLOWED: Record<string, string[]> = {
  queued: ['opened', 'declined', 'opted_out'],
  opened: ['sent', 'declined', 'opted_out'],
  sent: ['replied', 'interested', 'declined', 'opted_out'],
  replied: ['interested', 'deposit_pending', 'booked', 'declined', 'opted_out'],
  interested: ['deposit_pending', 'booked', 'declined', 'opted_out'],
  deposit_pending: ['booked', 'declined', 'opted_out'],
  booked: ['opted_out'],
  declined: ['opted_out'],
  opted_out: [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;
  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const routeParams = await params;
  const campaignId = Number(routeParams.id);
  const contactId = Number(routeParams.contactId);
  if (![campaignId, contactId].every((value) => Number.isInteger(value) && value > 0)) {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }

  const parsed = campaignContactPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed' }, { status: 400 });
  }

  const [contact] = await db
    .select({
      id: campaignContacts.id,
      status: campaignContacts.status,
      guestId: campaignContacts.guestId,
      marketingConsent: guests.marketingConsent,
      guestStatus: guests.status,
      campaignStatus: eventCampaigns.status,
    })
    .from(campaignContacts)
    .innerJoin(eventCampaigns, eq(eventCampaigns.id, campaignContacts.campaignId))
    .innerJoin(guests, eq(guests.id, campaignContacts.guestId))
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
        eq(campaignContacts.restaurantId, restaurant.id),
        eq(eventCampaigns.restaurantId, restaurant.id),
      ),
    )
    .limit(1);
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });

  if (
    contact.status !== parsed.data.status &&
    !(ALLOWED[contact.status] ?? []).includes(parsed.data.status)
  ) {
    return Response.json(
      { error: `Illegal transition ${contact.status} → ${parsed.data.status}` },
      { status: 409 },
    );
  }

  const outboundStatuses = new Set(['opened', 'sent']);
  if (
    outboundStatuses.has(parsed.data.status) &&
    (!contact.marketingConsent || contact.guestStatus !== 'validated')
  ) {
    return Response.json({ error: 'Guest is not contactable' }, { status: 409 });
  }
  if (
    outboundStatuses.has(parsed.data.status) &&
    !['ready', 'active'].includes(contact.campaignStatus)
  ) {
    return Response.json(
      { error: 'La campaña debe estar lista o activa antes de operar WhatsApp' },
      { status: 409 },
    );
  }

  if (parsed.data.status === 'opted_out') {
    await db
      .update(guests)
      .set({ marketingConsent: false })
      .where(eq(guests.id, contact.guestId));
  }

  const [updated] = await db
    .update(campaignContacts)
    .set({
      status: parsed.data.status,
      notes: parsed.data.notes,
      ...contactTimestamps(parsed.data.status),
    })
    .where(
      and(
        eq(campaignContacts.id, contactId),
        eq(campaignContacts.campaignId, campaignId),
        eq(campaignContacts.restaurantId, restaurant.id),
      ),
    )
    .returning();

  return Response.json({ contact: updated });
}

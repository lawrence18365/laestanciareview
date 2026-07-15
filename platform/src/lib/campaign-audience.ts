import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignContacts, eventCampaigns, guests, guestVisits } from '@/db/schema';

export type AudienceRule = 'all_consented' | 'wine' | 'vip';

type AudienceGuest = {
  id: number;
  preferences: string[] | null;
  redemptionType: 'copa_vino' | 'postre' | 'otro' | null;
  promoType: string | null;
  visitCount: number;
};

export function classifyCampaignGuest(guest: AudienceGuest) {
  const promo = guest.promoType?.toLowerCase();
  const winePreference =
    guest.preferences?.some((preference) => preference.toLowerCase() === 'vino') ||
    promo === 'wine' ||
    promo === 'vino' ||
    promo === 'copa';

  if (guest.redemptionType === 'copa_vino') {
    return { segment: 'wine_redeemer', priority: 10, wineIntent: true, vip: guest.visitCount >= 5 };
  }
  if (winePreference) {
    return { segment: 'wine_preference', priority: 20, wineIntent: true, vip: guest.visitCount >= 5 };
  }
  if (guest.visitCount >= 5) {
    return { segment: 'vip', priority: 30, wineIntent: false, vip: true };
  }
  return { segment: 'general', priority: 100, wineIntent: false, vip: false };
}

export async function seedCampaignAudience({
  campaignId,
  restaurantId,
  audienceRule,
}: {
  campaignId: number;
  restaurantId: number;
  audienceRule: AudienceRule;
}) {
  const eligibleGuests = await db
    .select({
      id: guests.id,
      preferences: guests.preferences,
      redemptionType: guests.redemptionType,
      promoType: guests.promoType,
      visitCount: sql<number>`count(${guestVisits.id})`.mapWith(Number).as('visit_count'),
    })
    .from(guests)
    .innerJoin(guestVisits, eq(guestVisits.guestId, guests.id))
    .where(
      and(
        eq(guestVisits.restaurantId, restaurantId),
        eq(guests.status, 'validated'),
        eq(guests.marketingConsent, true),
      ),
    )
    .groupBy(guests.id);

  const selected = eligibleGuests
    .map((guest) => ({ guest, classification: classifyCampaignGuest(guest) }))
    .filter(({ classification }) => {
      if (audienceRule === 'wine') return classification.wineIntent;
      if (audienceRule === 'vip') return classification.vip;
      return true;
    });

  if (selected.length > 0) {
    const values = selected.map(({ guest, classification }) => ({
      campaignId,
      restaurantId,
      guestId: guest.id,
      segment: classification.segment,
      priority: classification.priority,
    }));

    // Neon/Postgres comfortably handles this audience size, but chunking keeps
    // the operation safe when a larger group imports thousands of guests.
    for (let i = 0; i < values.length; i += 500) {
      await db.insert(campaignContacts).values(values.slice(i, i + 500)).onConflictDoNothing();
    }
  }

  const now = new Date();
  await db
    .update(eventCampaigns)
    .set({ audienceSeededAt: now, updatedAt: now })
    .where(
      and(
        eq(eventCampaigns.id, campaignId),
        eq(eventCampaigns.restaurantId, restaurantId),
      ),
    );

  return {
    eligible: eligibleGuests.length,
    selected: selected.length,
    excludedByRule: eligibleGuests.length - selected.length,
  };
}

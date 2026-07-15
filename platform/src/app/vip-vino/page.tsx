import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eventCampaigns } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';

const LEON_SLUG = 'estancia-leon';
const WINE_CAMPAIGN_SLUG = 'cena-maridaje-santo-tomas-2026-07-30';

export default async function VipVinoPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm' || session.slug !== LEON_SLUG) redirect('/dashboard');

  const restaurant = await getRestaurantBySlug(LEON_SLUG);
  if (!restaurant) redirect('/login');

  const [campaign] = await db
    .select({ id: eventCampaigns.id })
    .from(eventCampaigns)
    .where(
      and(
        eq(eventCampaigns.restaurantId, restaurant.id),
        eq(eventCampaigns.slug, WINE_CAMPAIGN_SLUG),
      ),
    )
    .limit(1);

  redirect(campaign ? `/campaigns/${campaign.id}` : '/campaigns');
}

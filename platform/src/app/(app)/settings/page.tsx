import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import SettingsView from '@/components/dashboard/SettingsView';

export default async function SettingsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  return (
    <SettingsView
      settings={{
        name: restaurant.name,
        slug: restaurant.slug,
        googleReviewUrl: restaurant.googleReviewUrl ?? '',
        googleThreshold: restaurant.googleThreshold,
        managerEmail: restaurant.managerEmail ?? '',
        managerPhone: restaurant.managerPhone ?? '',
        alertPreference: restaurant.alertPreference ?? 'all',
        smsAlerts: restaurant.smsAlerts ?? false,
        whatsappAlerts: restaurant.whatsappAlerts ?? false,
        callmebotApiKey: restaurant.callmebotApiKey ?? '',
      }}
    />
  );
}

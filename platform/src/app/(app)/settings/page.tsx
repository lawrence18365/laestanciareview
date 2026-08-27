import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getLatestMercadopagoSubscription } from '@/lib/queries';
import SettingsView from '@/components/dashboard/SettingsView';
import {
  computeBillingStartDate,
  getPriceBreakdown,
  subscriptionBillingHasStarted,
} from '@/lib/mercadopago';

export default async function SettingsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const mercadopagoSubscription = await getLatestMercadopagoSubscription(restaurant.id);
  const priceBreakdown = getPriceBreakdown();
  // Per-restaurant trial: prefer the subscription row's billing start; for
  // restaurants without a row, show when billing would start if they
  // subscribed today.
  const billingStartsAt =
    mercadopagoSubscription?.billingStartsAt ?? computeBillingStartDate();

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
      }}
      billing={{
        provider: restaurant.billingProvider,
        status: restaurant.subscriptionStatus,
        mercadopagoStatus: mercadopagoSubscription?.status ?? null,
        nextPaymentDate: mercadopagoSubscription?.nextPaymentDate?.toISOString() ?? null,
        billingStartsAt: billingStartsAt.toISOString(),
        billingStarted: subscriptionBillingHasStarted(billingStartsAt),
        priceBreakdown: {
          base: priceBreakdown.base,
          processingCharge: priceBreakdown.processingCharge,
          total: priceBreakdown.total,
        },
      }}
    />
  );
}

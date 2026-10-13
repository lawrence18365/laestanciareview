import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getLatestMercadopagoSubscription } from '@/lib/queries';
import { getBrandForRestaurant } from '@/lib/brands';
import { isSolo } from '@/lib/onboarding-profile';
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
  // subscribed today (their own trial end, never a fresh trial window).
  const billingStartsAt =
    mercadopagoSubscription?.billingStartsAt ??
    computeBillingStartDate({ trialEndsAt: restaurant.trialEndsAt });

  return (
    <SettingsView
      isSolo={isSolo(restaurant)}
      settings={{
        name: restaurant.name,
        slug: restaurant.slug,
        googleReviewUrl: restaurant.googleReviewUrl ?? '',
        googlePlaceId: restaurant.googlePlaceId ?? '',
        // The custom logo is shown from its served URL, not from the data URL:
        // the settings screen is the one place that must render it, and the
        // URL is a few dozen bytes instead of up to 280 KB.
        logoUrl: restaurant.logoHash ? getBrandForRestaurant(restaurant).logo : null,
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

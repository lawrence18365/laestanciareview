import { verifySession } from '@/lib/session';
import { isRateTapStaff } from '@/lib/admin';
import { getRestaurantBySlug, getNewFeedbackCount } from '@/lib/queries';
import { redirect } from 'next/navigation';
import { getBrandForRestaurant, hasEventsQuotes } from '@/lib/brands';
import { t } from '@/lib/i18n';
import { getKnownGroupKey } from '@/lib/group-device';
import GroupDeviceMarker from '@/app/login/GroupDeviceMarker';
import { isSolo } from '@/lib/onboarding-profile';
import DashboardShell from '@/components/dashboard/DashboardShell';
import SubscriptionBlocked from '@/components/dashboard/SubscriptionBlocked';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  // Subscription gate: allow-list, not deny-list. Anything other than `active`
  // (paying / manual customer) or `trialing` (in-trial Stripe sub) hits the
  // block screen — including paused, unpaid, incomplete, or any status Stripe
  // adds in the future. Manual customers have status='active' with no Stripe
  // subscription and pass through fine.
  const allowedStatuses = new Set(['active', 'trialing']);
  if (!allowedStatuses.has(restaurant.subscriptionStatus)) {
    return (
      <SubscriptionBlocked
        status={restaurant.subscriptionStatus}
        restaurantName={restaurant.name}
        billingProvider={restaurant.billingProvider}
      />
    );
  }

  // Group accounts' devices keep the login dropdown after logout: ask the
  // server (a layout cannot set cookies) to mark this device once.
  const needsGroupMarker =
    !!restaurant.groupKey && (await getKnownGroupKey()) !== restaurant.groupKey;

  const brand = getBrandForRestaurant(restaurant);
  const isOwner = session.role === 'owner';
  const isRegional = session.role === 'regional';
  const isMultiView = isOwner || isRegional;
  const newFeedbackCount = isMultiView ? 0 : await getNewFeedbackCount(restaurant.id);

  const displayName = isOwner
    ? t.nav.ownerDashboard
    : isRegional
      ? t.nav.regionalDashboard
      : restaurant.name;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {needsGroupMarker && <GroupDeviceMarker />}
      <DashboardShell
        restaurantName={displayName}
        logoSrc={brand.logo}
        logoDarkBg={brand.darkBg}
        newFeedbackCount={newFeedbackCount}
        isOwner={isMultiView}
        isRegional={isRegional}
        isStaff={isRateTapStaff(session)}
        isSolo={isSolo(restaurant)}
        showEventsQuotes={hasEventsQuotes(session.slug)}
        slug={session.slug}
        role={session.role}
      >
        {children}
      </DashboardShell>
    </div>
  );
}

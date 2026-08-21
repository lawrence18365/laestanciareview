import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getNewFeedbackCount } from '@/lib/queries';
import { redirect } from 'next/navigation';
import { getBrandForSlug } from '@/lib/brands';
import { t } from '@/lib/i18n';
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
      />
    );
  }

  const brand = getBrandForSlug(session.slug);
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
      <DashboardShell
        restaurantName={displayName}
        logoSrc={brand.logo}
        logoDarkBg={brand.darkBg}
        newFeedbackCount={newFeedbackCount}
        isOwner={isMultiView}
        isRegional={isRegional}
        slug={session.slug}
        role={session.role}
      >
        {children}
      </DashboardShell>
    </div>
  );
}

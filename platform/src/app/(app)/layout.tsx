import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getNewFeedbackCount } from '@/lib/queries';
import { redirect } from 'next/navigation';
import { getBrandForSlug } from '@/lib/brands';
import { t } from '@/lib/i18n';
import DashboardNav from '@/components/dashboard/DashboardNav';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const brand = getBrandForSlug(session.slug);
  const isOwner = session.role === 'owner';
  const newFeedbackCount = isOwner ? 0 : await getNewFeedbackCount(restaurant.id);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <DashboardNav
        restaurantName={isOwner ? t.nav.ownerDashboard : restaurant.name}
        logoSrc={brand.logo}
        logoDarkBg={brand.darkBg}
        newFeedbackCount={newFeedbackCount}
        isOwner={isOwner}
      />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {children}
      </main>
    </div>
  );
}

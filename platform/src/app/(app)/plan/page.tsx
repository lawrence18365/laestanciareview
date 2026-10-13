import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import { planFor, selfServePrice, usesPlanRestaurantePrice } from '@/lib/entitlements';
import { t } from '@/lib/i18n';
import PlanChooser from '@/components/dashboard/PlanChooser';

/**
 * Plan Restaurante checkout page. Self-serve single-location restaurants only:
 * Grupo restaurants and anyone already paying go to /settings, where billing
 * lives today.
 */
export default async function PlanPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const plan = planFor(restaurant);
  if (!usesPlanRestaurantePrice(restaurant) || (plan !== 'trial' && plan !== 'free')) {
    redirect('/settings');
  }

  return (
    <div className="page-container" style={{ maxWidth: 760 }}>
      <h1
        style={{
          margin: 0,
          color: 'var(--text-main)',
          fontFamily: 'var(--font-serif)',
          fontSize: '1.75rem',
          fontWeight: 600,
        }}
      >
        {t.upgrade.plan.title}
      </h1>
      <PlanChooser
        monthly={selfServePrice('monthly')}
        annual={selfServePrice('annual')}
        plan={plan}
      />
    </div>
  );
}

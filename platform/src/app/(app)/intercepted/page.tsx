import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getInterceptedReviews } from '@/lib/queries';
import InterceptedDrilldown from '@/components/dashboard/InterceptedDrilldown';

export default async function InterceptedPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owner & regional managers only
  if (session.role !== 'owner' && session.role !== 'regional') redirect('/dashboard');

  const regionFilter = session.role === 'regional' ? session.region : undefined;
  const reviews = await getInterceptedReviews(regionFilter);

  return (
    <InterceptedDrilldown
      reviews={reviews.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}

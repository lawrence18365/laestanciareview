import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getGroupKeyBySlug, getInterceptedReviews } from '@/lib/queries';
import InterceptedDrilldown from '@/components/dashboard/InterceptedDrilldown';

export default async function InterceptedPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owner & regional managers only
  if (session.role !== 'owner' && session.role !== 'regional') redirect('/dashboard');

  const regionFilter = session.role === 'regional' ? session.region : undefined;
  const groupKey = await getGroupKeyBySlug(session.slug);
  const reviews = await getInterceptedReviews(groupKey, regionFilter);

  return (
    <InterceptedDrilldown
      reviews={reviews.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}

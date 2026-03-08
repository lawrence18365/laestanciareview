import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getAllFeedback } from '@/lib/queries';
import FeedbackInbox from '@/components/dashboard/FeedbackInbox';

export default async function InboxPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const feedback = await getAllFeedback(restaurant.id);

  return (
    <FeedbackInbox
      initialFeedback={feedback.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
      }))}
    />
  );
}

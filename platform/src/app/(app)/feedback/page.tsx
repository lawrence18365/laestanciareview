import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import GMFeedbackForm from '@/components/dashboard/GMFeedbackForm';

export default async function FeedbackPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  return (
    <GMFeedbackForm
      restaurantName={restaurant.name}
      restaurantSlug={session.slug}
    />
  );
}

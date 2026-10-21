import { getKnownGroupAccounts } from '@/lib/group-device';
import { getRestaurantBySlug } from '@/lib/queries';
import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Someone already signed in does not need the form. The restaurant lookup is
  // the safety valve: /dashboard sends a session whose restaurant is gone back
  // here, so redirecting on a failed lookup would be a redirect loop.
  const session = await verifySession();
  if (session) {
    const restaurant = await getRestaurantBySlug(session.slug).catch(() => null);
    if (restaurant) {
      redirect(session.role === 'owner' || session.role === 'regional' ? '/overview' : '/dashboard');
    }
  }
  return <LoginForm groupAccounts={await getKnownGroupAccounts()} />;
}

import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import StaffManager from '@/components/dashboard/StaffManager';

export default async function StaffPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const staffList = await getStaffList(restaurant.id);

  return <StaffManager initialStaff={staffList} />;
}

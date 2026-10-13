import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import { getBrandForRestaurant } from '@/lib/brands';
import { generateQrDataUrl } from '@/lib/qr';
import CardQrGrid from '@/components/dashboard/CardQrGrid';

export default async function QrCodesPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const staffList = await getStaffList(restaurant.id);
  const activeStaff = staffList.filter((s) => s.active);
  const brand = getBrandForRestaurant(restaurant);
  const restaurantQr = await generateQrDataUrl(restaurant.slug);

  return (
    <CardQrGrid
      staff={activeStaff}
      slug={restaurant.slug}
      restaurantName={restaurant.name}
      logo={brand.logo}
      logoDarkBg={brand.darkBg}
      restaurantQr={restaurantQr}
      teamMode={restaurant.teamMode}
    />
  );
}

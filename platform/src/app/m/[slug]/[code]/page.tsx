import { notFound } from 'next/navigation';
import { getRestaurantBySlug, getStaffByCode, getStaffPersonalStats } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import MeseroCard from '@/components/mesero/MeseroCard';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string; code: string }>;
}

export default async function MeseroPage({ params }: PageProps) {
  const { slug, code } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const staffMember = await getStaffByCode(restaurant.id, decodeURIComponent(code));
  if (!staffMember) notFound();

  const stats = await getStaffPersonalStats(restaurant.id, staffMember.id);
  const brand = getBrandForSlug(slug);

  return (
    <MeseroCard
      staffName={staffMember.name}
      restaurantName={restaurant.name}
      logoSrc={brand.logo}
      logoDarkBg={brand.darkBg}
      stats={stats}
    />
  );
}

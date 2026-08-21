import { notFound } from 'next/navigation';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import { recordProductEvent } from '@/lib/product-events';
import ValidateForm from './ValidateForm';

// Public page bookmarked on the server/hostess tablet. Waiter types the 4-digit
// code the guest shows them, picks their own name from the roster, and picks
// the redemption type. No auth — trust model is "the tablet is trusted."

export default async function ValidatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const activeStaff = await db
    .select({ id: staff.id, code: staff.code, name: staff.name })
    .from(staff)
    .where(and(eq(staff.restaurantId, restaurant.id), eq(staff.active, true)))
    .orderBy(staff.name);

  const brand = getBrandForSlug(slug);

  // Fire-and-forget — analytics must never block the render path.
  void recordProductEvent({
    name: 'validation_page_open',
    restaurantId: restaurant.id,
    role: 'staff',
    path: `/v/${slug}`,
  });

  return (
    <ValidateForm
      slug={slug}
      restaurantName={restaurant.name}
      brandLogo={brand.logo}
      brandDarkBg={brand.darkBg}
      staffList={activeStaff}
    />
  );
}

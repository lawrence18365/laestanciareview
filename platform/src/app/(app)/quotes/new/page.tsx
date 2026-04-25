import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getBrandForSlug } from '@/lib/brands';
import QuoteBuilderV2 from '@/components/quotes/QuoteBuilderV2';

export default async function NewQuotePage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const [restaurant] = await db
    .select({ name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  const brand = getBrandForSlug(session.slug);

  return (
    <QuoteBuilderV2
      restaurantName={restaurant?.name ?? 'La Estancia'}
      logoSrc={brand.logo}
    />
  );
}

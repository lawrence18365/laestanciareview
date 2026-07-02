/**
 * Public, unauthenticated, read-only view of a single quote, reached via the
 * unguessable share token the /api/quotes/[id]/send route mints. The guest
 * opens this on their phone from the WhatsApp link.
 *
 * Security: looked up strictly by public_token; only that one quote and its
 * restaurant's display name/logo are exposed — no session, no cross-tenant
 * data, no dashboard chrome (root layout only). noindex so links don't leak
 * into search.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { getBrandForSlug } from '@/lib/brands';
import { migrateConfig, type QuoteConfig } from '@/lib/quote-data';
import QuotePreview from '@/components/quotes/QuotePreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Tokens are 24 hex chars; anything shorter can't be one of ours.
  if (!token || token.length < 16) notFound();

  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.publicToken, token))
    .limit(1);
  if (!quote) notFound();

  const [restaurant] = await db
    .select({ name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.id, quote.restaurantId))
    .limit(1);
  if (!restaurant) notFound();

  // Only V2 quotes (with builder state) are shareable; legacy rows aren't.
  if (!quote.configJson || typeof quote.configJson !== 'object') notFound();

  const brand = getBrandForSlug(restaurant.slug);
  const folio = quote.quoteNumber ?? `Q-${String(quote.id).padStart(4, '0')}`;
  const config = migrateConfig(quote.configJson as QuoteConfig);

  return (
    <div style={{ background: '#F5F2EC', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <QuotePreview
          config={config}
          folio={folio}
          restaurantName={restaurant.name}
          logoSrc={brand.logo}
        />
      </div>
    </div>
  );
}

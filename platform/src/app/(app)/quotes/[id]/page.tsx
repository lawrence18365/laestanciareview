import { redirect, notFound } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getBrandForSlug } from '@/lib/brands';
import QuoteBuilderV2 from '@/components/quotes/QuoteBuilderV2';
import { emptyConfig, type QuoteConfig } from '@/lib/quote-data';

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) notFound();

  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant) redirect('/login');
  const brand = getBrandForSlug(session.slug);

  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurant.id)))
    .limit(1);
  if (!quote) notFound();

  // Prefer the stored builder state. Legacy rows without configJson get a
  // blank config seeded with the top-level client/event data.
  let initialConfig: QuoteConfig;
  if (quote.configJson && typeof quote.configJson === 'object') {
    initialConfig = quote.configJson as QuoteConfig;
  } else {
    const c = emptyConfig();
    c.evento = {
      ...c.evento,
      cliente: quote.clientName ?? '',
      telefono: quote.clientPhone ?? '',
      fecha: quote.eventDate ?? '',
      tipo: quote.eventType || 'Otro',
      personas: quote.guestCount || 1,
    };
    if (quote.terms) c.terms = quote.terms;
    initialConfig = c;
  }

  const quoteNumber = quote.quoteNumber ?? `Q-${String(quoteId).padStart(4, '0')}`;

  return (
    <QuoteBuilderV2
      initialConfig={initialConfig}
      quoteId={quoteId}
      quoteNumber={quoteNumber}
      restaurantName={restaurant.name}
      logoSrc={brand.logo}
    />
  );
}

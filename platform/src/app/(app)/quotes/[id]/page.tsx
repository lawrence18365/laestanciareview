import { redirect, notFound } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import QuoteBuilder from '@/components/quotes/QuoteBuilder';
import { type QuoteItemsMap, emptyItemsMap } from '@/lib/quote-defaults';

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) notFound();

  const restaurant = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant[0]) redirect('/login');

  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurant[0].id)))
    .limit(1);
  if (!quote) notFound();

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(quoteItems.sortOrder);

  // Rebuild items map from flat list
  const itemsMap: QuoteItemsMap = emptyItemsMap();
  for (const item of items) {
    const cat = item.category as keyof QuoteItemsMap;
    if (cat in itemsMap) {
      itemsMap[cat].push(item.name);
    }
  }

  const initialData = {
    clientName: quote.clientName,
    clientPhone: quote.clientPhone ?? '',
    clientEmail: quote.clientEmail ?? '',
    clientCompany: quote.clientCompany ?? '',
    eventDate: quote.eventDate ?? '',
    eventType: quote.eventType ?? '',
    guestCount: String(quote.guestCount),
    eventNotes: quote.eventNotes ?? '',
    packageName: quote.packageName ?? '',
    pricePerPerson: quote.pricePerPerson,
    serviceChargePercent: quote.serviceChargePercent,
    ivaPercent: quote.ivaPercent,
    terms: quote.terms ?? '',
    items: itemsMap,
  };

  return <QuoteBuilder initialData={initialData} quoteId={quoteId} />;
}

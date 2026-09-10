import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { migrateConfig, computePricing, type QuoteConfig } from '@/lib/quote-data';
import { verifySession } from '@/lib/session';
import { getQuoteConversion } from '@/lib/quote-lifecycle';
import QuoteList from './QuoteList';

// The snapshot column is gone, so config_json is now the only price source.
// Recompute from builder state so the list agrees with the opened quote.
function listPricePerPerson(row: { configJson: unknown }): string {
  const raw = row.configJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '0';
  try {
    const config = migrateConfig(raw as QuoteConfig);
    return String(Math.round(computePricing(config).precioFinalPP || 0));
  } catch {
    return '0';
  }
}

export default async function QuotesPage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  const restaurant = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant[0]) redirect('/login');

  // Every quote is loaded, including closed ones — they are the denominator for
  // the conversion readout and are never deleted. QuoteList hides the closed
  // ones behind a filter and shows the active list by default.
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.restaurantId, restaurant[0].id))
    .orderBy(desc(quotes.createdAt));

  const serialized = rows.map((q) => ({
    ...q,
    pricePerPerson: listPricePerPerson(q),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    outcomeAt: q.outcomeAt ? q.outcomeAt.toISOString() : null,
  }));

  // Rolling 12 months: long enough that a seasonal events business has
  // something to show, short enough to still describe the business today.
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setFullYear(periodStart.getFullYear() - 1);
  const conversion = await getQuoteConversion(restaurant[0].id, periodStart, periodEnd);

  return (
    <QuoteList
      quotes={serialized}
      restaurantName={restaurant[0].name}
      conversion={conversion}
    />
  );
}

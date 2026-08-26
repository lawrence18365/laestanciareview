import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { migrateConfig, computePricing, type QuoteConfig } from '@/lib/quote-data';
import { verifySession } from '@/lib/session';
import QuoteList from './QuoteList';

// The stored price_per_person is a snapshot written when the quote was
// last saved. It goes stale whenever a pricing input changes (a menu
// price, a beverage package). config_json holds the builder state, so
// recompute from it and let the list agree with what opening the quote
// shows. Legacy pre-V2 rows have no config_json - keep their snapshot.
function listPricePerPerson(row: { pricePerPerson: string; configJson: unknown }): string {
  const raw = row.configJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return row.pricePerPerson;
  try {
    const config = migrateConfig(raw as QuoteConfig);
    return String(Math.round(computePricing(config).precioFinalPP || 0));
  } catch {
    return row.pricePerPerson;
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
  }));

  return <QuoteList quotes={serialized} restaurantName={restaurant[0].name} />;
}

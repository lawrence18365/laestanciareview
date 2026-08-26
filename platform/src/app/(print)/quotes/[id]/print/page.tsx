import { notFound, redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getBrandForSlug } from '@/lib/brands';
import { migrateConfig, type QuoteConfig } from '@/lib/quote-data';
import QuotePreview from '@/components/quotes/QuotePreview';
import PrintButton from './PrintButton';

export default async function PrintQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  if (!session) redirect('/login');

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) notFound();

  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, city: restaurants.city })
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

  const quoteNumber = quote.quoteNumber ?? `Q-${String(quoteId).padStart(4, '0')}`;

  if (!quote.configJson || typeof quote.configJson !== 'object' || Array.isArray(quote.configJson)) {
    notFound();
  }
  const config = migrateConfig(quote.configJson as QuoteConfig);

  return (
    <>
      <style>{`
        @media print {
          body, html { background: white !important; margin: 0 !important; }
          .q-no-print { display: none !important; }
          .q-print-wrap { background: white !important; padding: 0 !important; min-height: 0 !important; }
          @page { margin: 1.2cm; }
        }
      `}</style>

      <div className="q-no-print" style={{
        background: '#1a1a1a',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <a href={`/quotes/${quoteId}`} style={{ color: '#aaa', fontSize: '0.72rem', textDecoration: 'none', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            ← Editar cotización
          </a>
          <span style={{ color: '#555', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            {quoteNumber}
          </span>
        </div>
        <PrintButton />
      </div>

      <div className="q-print-wrap" style={{ background: '#F5F2EC', minHeight: '100vh', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <QuotePreview
            config={config}
            folio={quoteNumber}
            restaurantName={restaurant.name}
            logoSrc={brand.logo}
          />
        </div>
      </div>
    </>
  );
}

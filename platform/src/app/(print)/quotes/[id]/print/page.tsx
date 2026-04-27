import { notFound, redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, quoteItems, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { getBrandForSlug } from '@/lib/brands';
import { CATEGORY_LABELS, type MenuCategory } from '@/lib/quote-defaults';
import { migrateConfig, type QuoteConfig } from '@/lib/quote-data';
import QuotePreview from '@/components/quotes/QuotePreview';
import PrintButton from './PrintButton';

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

const CATEGORY_ORDER: MenuCategory[] = [
  'entrada', 'ensalada', 'corte', 'guarnicion', 'postre', 'bebida', 'vino', 'extra',
];

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

  // V2 quotes: render from configJson
  if (quote.configJson && typeof quote.configJson === 'object') {
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

  // Legacy rendering path (rows created before V2 shipped)
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(quoteItems.sortOrder);

  const grouped: Partial<Record<MenuCategory, string[]>> = {};
  for (const item of items) {
    const cat = item.category as MenuCategory;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(item.name);
  }

  const guests = quote.guestCount;
  const pp = parseFloat(quote.pricePerPerson) || 0;
  const scPct = parseFloat(quote.serviceChargePercent) || 0;
  const ivaPct = parseFloat(quote.ivaPercent) || 0;
  const subtotal = pp * guests;
  const serviceCharge = subtotal * (scPct / 100);
  const subtotalWithSC = subtotal + serviceCharge;
  const ivaAmt = subtotalWithSC * (ivaPct / 100);
  const total = subtotalWithSC + ivaAmt;

  const hasItems = Object.values(grouped).some((arr) => arr && arr.length > 0);

  return (
    <>
      <style>{`
        .quote-print-page body,
        body { background: #f5f5f0 !important; }
        .q-no-print { display: block; }
        @media print {
          body, html { background: white !important; margin: 0 !important; }
          .q-no-print { display: none !important; }
          .q-page {
            box-shadow: none !important;
            margin: 0 !important;
            max-width: 100% !important;
            padding: 1.5cm 2cm !important;
          }
          @page { margin: 1cm; }
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
          <a href={`/quotes/${quoteId}`} style={{ color: '#aaa', fontSize: '0.72rem', textDecoration: 'none', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
            ← Editar cotización
          </a>
          <span style={{ color: '#555', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            {quoteNumber}
          </span>
        </div>
        <PrintButton />
      </div>

      <div style={{ background: '#f5f5f0', minHeight: '100vh', padding: '2rem 1rem' }}>
        <div className="q-page" style={{
          maxWidth: 780,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 2px 24px rgba(0,0,0,0.12)',
          padding: '3rem 3.5rem',
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: '#1a1a1a',
        }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 400, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a', fontFamily: "Georgia, serif" }}>
                La Estancia
              </h1>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
                Restaurante Argentino
                {restaurant.city ? ` · ${restaurant.city}` : ''}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.06em', color: '#1a1a1a', fontFamily: 'monospace' }}>
                {quoteNumber}
              </p>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.7rem', color: '#888', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
                Cotización de Evento
              </p>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.7rem', color: '#888', fontFamily: 'sans-serif' }}>
                Válida hasta: {addDays(15)}
              </p>
            </div>
          </div>

          <div style={{ borderTop: '2px solid #1a1a1a', marginBottom: '2rem' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
            <div>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
                Preparado para
              </p>
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, fontFamily: 'sans-serif' }}>{quote.clientName}</p>
              {quote.clientCompany && <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#555', fontFamily: 'sans-serif' }}>{quote.clientCompany}</p>}
              {quote.clientPhone && <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#555', fontFamily: 'sans-serif' }}>{quote.clientPhone}</p>}
              {quote.clientEmail && <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#555', fontFamily: 'sans-serif' }}>{quote.clientEmail}</p>}
            </div>
            <div>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
                Detalles del Evento
              </p>
              {quote.eventDate && (
                <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', fontFamily: 'sans-serif' }}>
                  <strong>Fecha:</strong> {formatDate(quote.eventDate)}
                </p>
              )}
              {quote.eventType && (
                <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', fontFamily: 'sans-serif' }}>
                  <strong>Tipo:</strong> {quote.eventType}
                </p>
              )}
              <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', fontFamily: 'sans-serif' }}>
                <strong>Personas:</strong> {guests}
              </p>
              {quote.packageName && (
                <p style={{ margin: '0 0 0.2rem', fontSize: '0.82rem', fontFamily: 'sans-serif' }}>
                  <strong>Paquete:</strong> {quote.packageName}
                </p>
              )}
              {quote.eventNotes && (
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: '#555', fontStyle: 'italic', fontFamily: 'sans-serif' }}>
                  {quote.eventNotes}
                </p>
              )}
            </div>
          </div>

          {hasItems && (
            <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '1.5rem', marginBottom: '1.5rem' }}>
              <p style={{ margin: '0 0 1.25rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
                Menú Seleccionado
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {CATEGORY_ORDER.map((cat) => {
                    const catItems = grouped[cat];
                    if (!catItems || catItems.length === 0) return null;
                    return (
                      <tr key={cat} style={{ verticalAlign: 'top' }}>
                        <td style={{ padding: '0.45rem 1.25rem 0.45rem 0', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', whiteSpace: 'nowrap', width: '130px', borderBottom: '1px solid #f5f5f5', fontFamily: 'sans-serif' }}>
                          {CATEGORY_LABELS[cat]}
                        </td>
                        <td style={{ padding: '0.45rem 0', fontSize: '0.85rem', color: '#1a1a1a', lineHeight: 1.5, borderBottom: '1px solid #f5f5f5', fontFamily: 'sans-serif' }}>
                          {catItems.join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '1.5rem', marginBottom: '1.5rem' }}>
            <p style={{ margin: '0 0 1rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
              Resumen de Precios
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <PriceRow label={`${guests} personas × ${formatMXN(pp)} por persona`} value={formatMXN(subtotal)} />
                <PriceRow label={`Cargo por servicio (${scPct}%)`} value={formatMXN(serviceCharge)} />
                <PriceRow label={`IVA (${ivaPct}%)`} value={formatMXN(ivaAmt)} />
                <tr>
                  <td colSpan={2} style={{ padding: '0.35rem 0' }}>
                    <div style={{ borderTop: '2px solid #1a1a1a' }} />
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem 0', fontSize: '1rem', fontWeight: 700, fontFamily: 'sans-serif' }}>Total</td>
                  <td style={{ padding: '0.5rem 0', fontSize: '1rem', fontWeight: 700, textAlign: 'right', fontFamily: 'monospace' }}>
                    {formatMXN(total)} MXN
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {quote.terms && (
            <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '1.5rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#888', fontFamily: 'sans-serif' }}>
                Términos y Condiciones
              </p>
              <div style={{ fontSize: '0.75rem', color: '#555', lineHeight: 1.9, whiteSpace: 'pre-line', fontFamily: 'sans-serif' }}>
                {quote.terms}
              </div>
            </div>
          )}

          <div style={{ borderTop: '1px solid #e0e0e0', marginTop: '2rem', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.65rem', color: '#aaa', letterSpacing: '0.06em', fontFamily: 'sans-serif' }}>
              {restaurant.name}
            </p>
            <p style={{ margin: 0, fontSize: '0.65rem', color: '#aaa', fontFamily: 'monospace' }}>
              {quoteNumber}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '0.35rem 0', fontSize: '0.82rem', color: '#555', fontFamily: 'sans-serif' }}>{label}</td>
      <td style={{ padding: '0.35rem 0', fontSize: '0.82rem', textAlign: 'right', color: '#555', fontFamily: 'monospace' }}>{value}</td>
    </tr>
  );
}

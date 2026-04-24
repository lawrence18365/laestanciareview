import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import GuestCaptureForm from './GuestCaptureForm';

// Per-brand Instagram handles shown on the confirmation screen.
// Solves the grupo + local dual-handle problem: both the agency-owned account
// and the local-market account get a follow prompt on every redemption.
const igByBrand: Record<string, Array<{ handle: string; label: string }>> = {
  estancia: [
    { handle: 'estanciaargentinaoficial', label: 'Grupo Estancia' },
    { handle: 'laestancialeon', label: 'La Estancia León' },
  ],
};

export default async function GuestCapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    promo?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  if (!restaurant.brand) {
    // Owner/regional rows aren't single-brand — they shouldn't have a capture URL.
    return <ErrorShell message="Esta ubicación aún no está configurada para capturar invitados." />;
  }

  const brand = getBrandForSlug(slug);
  const igHandles = igByBrand[restaurant.brand] ?? [];

  return (
    <GuestCaptureForm
      slug={slug}
      restaurantName={restaurant.name}
      brandSlug={restaurant.brand}
      brandLogo={brand.logo}
      brandDarkBg={brand.darkBg}
      promoType={sp.promo}
      utmSource={sp.utm_source}
      utmMedium={sp.utm_medium}
      utmCampaign={sp.utm_campaign}
      igHandles={igHandles}
    />
  );
}

function ErrorShell({ message }: { message: string }) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAFAF9',
        padding: '2rem 1rem',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          border: '1px solid #1c1917',
          padding: '2rem 1.75rem',
          textAlign: 'center',
          boxShadow: '6px 6px 0 rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>⚠️</div>
        <p style={{ color: '#57534e', margin: 0, lineHeight: 1.5 }}>{message}</p>
      </div>
    </main>
  );
}

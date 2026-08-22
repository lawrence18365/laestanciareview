import { notFound } from 'next/navigation';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import { recordProductEvent } from '@/lib/product-events';
import { normalizeStaffCode } from '@/lib/staff-code';
import StarRating from '@/components/review/StarRating';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ card?: string }>;
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { card } = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const staffCode = normalizeStaffCode(card ?? '');
  const staffMember = staffCode ? await getStaffByCode(restaurant.id, staffCode) : null;
  const staffName = staffMember?.name ?? 'Tu mesero';
  const brand = getBrandForSlug(slug);

  // Fire-and-forget — analytics must never block the render path.
  void recordProductEvent({
    name: 'review_page_open',
    restaurantId: restaurant.id,
    staffId: staffMember?.id ?? null,
    role: 'guest',
    path: `/r/${slug}`,
    properties: { staff_code: staffCode || null, has_card: !!card },
  });

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAFAF9',
        padding: '2rem 1rem 4.5rem',
        position: 'relative',
      }}
    >
      {/* Gold accent bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: '#D97706',
        zIndex: 10,
      }} />

      {/* Hero Logo — large and dominant */}
      <div
        style={{
          width: 160,
          height: 160,
          overflow: 'hidden',
          background: brand.darkBg ? '#111' : '#fff',
          border: '2px solid #111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.75rem',
          flexShrink: 0,
          boxShadow: '6px 6px 0px rgba(0,0,0,0.06)',
          animation: 'logoReveal 0.5s ease-out both',
        }}
      >
        <img
          src={brand.logo}
          alt={restaurant.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            padding: 12,
          }}
        />
      </div>

      <StarRating
        restaurantSlug={slug}
        staffCode={staffCode}
        staffName={staffName}
        restaurantName={restaurant.name}
      />

      {/* Footer */}
      <footer
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          textAlign: 'center',
          paddingBottom: '1.25rem',
          paddingTop: '0.75rem',
          fontSize: '0.6rem',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#A3A3A3',
        }}
      >
        DESARROLLADO POR <span style={{ fontWeight: 700, color: '#111' }}>RATETAP</span>
      </footer>

      <style>{`
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </main>
  );
}

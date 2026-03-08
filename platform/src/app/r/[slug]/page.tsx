import { notFound } from 'next/navigation';
import { getRestaurantBySlug, getStaffByCode } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
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

  const staffCode = card ?? 'UNKNOWN';
  const staffMember = await getStaffByCode(restaurant.id, staffCode);
  const staffName = staffMember?.name ?? staffCode;
  const brand = getBrandForSlug(slug);

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FAFAF9',
        padding: '1.5rem 1rem 4rem',
        position: 'relative',
      }}
    >
      {/* Subtle top accent line */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: '#D97706',
      }} />

      {/* Restaurant Logo */}
      <div
        style={{
          width: 96,
          height: 96,
          overflow: 'hidden',
          background: brand.darkBg ? '#111' : '#fff',
          border: '1px solid #E2E2E2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.25rem',
          flexShrink: 0,
        }}
      >
        <img
          src={brand.logo}
          alt={restaurant.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            padding: 6,
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
    </main>
  );
}

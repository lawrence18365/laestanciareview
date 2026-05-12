import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import FeedbackForm from '@/components/review/FeedbackForm';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewId?: string; feedbackToken?: string }>;
}

export default async function FeedbackPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { reviewId, feedbackToken } = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

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
      {/* Top accent */}
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
          width: 120,
          height: 120,
          overflow: 'hidden',
          background: brand.darkBg ? '#111' : '#fff',
          border: '2px solid #111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          flexShrink: 0,
          boxShadow: '4px 4px 0px rgba(0,0,0,0.06)',
        }}
      >
        <img
          src={brand.logo}
          alt={restaurant.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            padding: 10,
          }}
        />
      </div>

      {/* Feedback Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#FFFFFF',
          border: '1px solid #111',
          boxShadow: '6px 6px 0px rgba(0,0,0,0.05)',
        }}
      >
        <FeedbackForm
          restaurantName={restaurant.name}
          restaurantSlug={slug}
          reviewId={reviewId ?? null}
          feedbackToken={feedbackToken ?? null}
        />
      </div>

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

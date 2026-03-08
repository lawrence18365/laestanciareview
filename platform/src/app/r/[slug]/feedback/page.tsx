import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries';
import { getBrandForSlug } from '@/lib/brands';
import { t } from '@/lib/i18n';
import FeedbackForm from '@/components/review/FeedbackForm';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewId?: string }>;
}

export default async function FeedbackPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { reviewId } = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const brand = getBrandForSlug(slug);

  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center"
      style={{
        background:
          'linear-gradient(165deg, #faf6f1 0%, #f0e9df 50%, #ebe3d7 100%)',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 14,
          overflow: 'hidden',
          background: brand.darkBg ? '#1c1917' : '#fff',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1rem',
        }}
      >
        <img
          src={brand.logo}
          alt={restaurant.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            padding: 5,
          }}
        />
      </div>

      <div
        className="w-full max-w-[460px] mx-auto"
        style={{
          background: 'var(--warm-white)',
          borderRadius: 24,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <FeedbackForm
          restaurantName={restaurant.name}
          restaurantSlug={slug}
          reviewId={reviewId ?? null}
        />
      </div>

      <footer
        className="fixed bottom-0 inset-x-0 text-center pb-5 pt-3"
        style={{
          fontSize: 11,
          letterSpacing: '0.06em',
          color: 'var(--stone-400)',
        }}
      >
        {t.common.poweredBy}{' '}
        <span className="font-semibold" style={{ color: 'var(--stone-500)' }}>
          RateTap
        </span>
      </footer>
    </main>
  );
}

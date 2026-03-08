'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

interface StarRatingProps {
  restaurantSlug: string;
  staffCode: string;
  staffName: string;
  restaurantName: string;
}

function StarIcon({ filled, size = 48 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export default function StarRating({
  restaurantSlug,
  staffCode,
  staffName,
  restaurantName,
}: StarRatingProps) {
  const router = useRouter();
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedStar, setSelectedStar] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [popStar, setPopStar] = useState(0);
  const [error, setError] = useState(false);

  const handleSubmit = useCallback(
    async (rating: number) => {
      setSelectedStar(rating);
      setPopStar(rating);
      setSubmitting(true);
      setError(false);

      try {
        const res = await fetch('/api/reviews/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurantSlug, staffCode, rating }),
        });

        if (!res.ok) throw new Error('Submit failed');

        const data = await res.json();

        if (data.action === 'google' && data.googleReviewUrl) {
          setTimeout(() => {
            window.location.href = data.googleReviewUrl;
          }, 600);
        } else {
          setTimeout(() => {
            router.push(
              `/r/${restaurantSlug}/feedback?reviewId=${data.reviewId}`,
            );
          }, 400);
        }
      } catch {
        setSubmitting(false);
        setSelectedStar(0);
        setPopStar(0);
        setError(true);
      }
    },
    [restaurantSlug, staffCode, router],
  );

  const displayRating = hoveredStar || selectedStar;

  return (
    <div
      style={{ animation: 'scaleIn 0.5s ease-out both' }}
      className="flex flex-col items-center px-6 py-10 w-full max-w-md mx-auto"
    >
      {/* Restaurant name */}
      <h1
        style={{
          fontFamily: 'var(--font-cormorant), Georgia, serif',
          letterSpacing: '-0.02em',
        }}
        className="text-[clamp(36px,7vw,48px)] font-semibold text-center leading-[1.05] mb-2"
      >
        {restaurantName}
      </h1>

      {/* Decorative line */}
      <div
        className="mx-auto my-5"
        style={{
          width: 48,
          height: 1,
          background:
            'linear-gradient(90deg, transparent, var(--stone-300), transparent)',
        }}
      />

      {/* Question */}
      <p className="text-center text-[17px] leading-relaxed mb-9" style={{ color: 'var(--stone-700)' }}>
        {t.starRating.howWasYourExperience}{' '}
        <span className="font-semibold" style={{ color: 'var(--espresso)' }}>
          {staffName}
        </span>
        ?
      </p>

      {/* Stars */}
      <div className="flex justify-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= displayRating;
          const isPopping = star === popStar;

          return (
            <button
              key={star}
              disabled={submitting}
              onMouseEnter={() => !submitting && setHoveredStar(star)}
              onMouseLeave={() => !submitting && setHoveredStar(0)}
              onClick={() => handleSubmit(star)}
              aria-label={t.starRating.rateStars(star)}
              className="border-0 bg-transparent rounded-lg p-1.5"
              style={{
                cursor: submitting ? 'default' : 'pointer',
                transition: 'transform 0.2s ease, filter 0.25s ease',
                transform: isFilled && !isPopping ? 'scale(1.08)' : 'scale(1)',
                filter: isFilled
                  ? 'drop-shadow(0 0 14px rgba(251, 191, 36, 0.45))'
                  : 'none',
                color: isFilled ? 'var(--amber-400)' : 'var(--stone-300)',
                opacity: submitting && !isFilled ? 0.25 : 1,
                animation: isPopping ? 'starPop 0.35s ease-out' : 'none',
              }}
            >
              <StarIcon filled={isFilled} />
            </button>
          );
        })}
      </div>

      {/* Hint / Error */}
      <p
        className="text-center text-[13px] min-h-[20px]"
        style={{
          color: error ? '#dc2626' : 'var(--stone-400)',
          transition: 'opacity 0.3s ease',
          animation: submitting ? 'pulse-soft 1.4s ease-in-out infinite' : 'none',
        }}
      >
        {error
          ? t.starRating.somethingWrong
          : submitting
            ? t.starRating.submittingRating
            : selectedStar === 0
              ? t.starRating.tapToRate
              : ''}
      </p>
    </div>
  );
}

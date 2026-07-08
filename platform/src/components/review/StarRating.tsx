'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

interface StarRatingProps {
  restaurantSlug: string;
  staffCode: string;
  staffName: string;
  restaurantName: string;
}

function StarIcon({ filled, size = 44 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.2}
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
  const [redirecting, setRedirecting] = useState(false);
  const [choice, setChoice] = useState<{
    reviewId: number;
    feedbackToken: string;
    googleReviewUrl: string | null;
  } | null>(null);

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
        if (!data.feedbackToken) throw new Error('Missing feedback token');

        // No rating-based routing: offer every guest the same two options and
        // let them choose (see chooseGoogle / chooseFeedback).
        setChoice({
          reviewId: data.reviewId,
          feedbackToken: data.feedbackToken,
          googleReviewUrl: data.googleReviewUrl ?? null,
        });
        setSubmitting(false);
      } catch {
        setSubmitting(false);
        setSelectedStar(0);
        setPopStar(0);
        setError(true);
      }
    },
    [restaurantSlug, staffCode, router],
  );

  function chooseFeedback() {
    if (!choice) return;
    router.push(
      `/r/${restaurantSlug}/feedback?reviewId=${choice.reviewId}&feedbackToken=${encodeURIComponent(choice.feedbackToken)}`,
    );
  }

  function chooseGoogle() {
    if (!choice?.googleReviewUrl) return;
    const url = choice.googleReviewUrl;
    // Record the guest's ACTUAL choice (analytics: sent_to_google). Best-effort.
    fetch('/api/reviews/chose-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: choice.reviewId, feedbackToken: choice.feedbackToken }),
    }).catch(() => {});
    const dl = (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
    if (Array.isArray(dl)) {
      dl.push({
        event: 'review_redirect_to_google',
        review_id: choice.reviewId,
        rating: selectedStar,
        restaurant_slug: restaurantSlug,
        staff_code: staffCode || 'no-card',
      });
    }
    setRedirecting(true);
    setTimeout(() => {
      window.location.href = url;
    }, 800);
  }

  // Stars lock once submitted / a choice is shown / redirecting.
  const locked = submitting || choice !== null || redirecting;
  const displayRating = hoveredStar || selectedStar;

  // Both choice buttons share one style — equal visual weight is the point
  // (no steering toward Google or away from a public review).
  const CHOICE_BTN: CSSProperties = {
    width: '100%',
    padding: '0.95rem 1rem',
    border: '1px solid #111',
    borderRadius: 0,
    background: '#fff',
    color: '#111',
    fontWeight: 700,
    fontSize: '0.78rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 1.5rem',
        width: '100%',
        maxWidth: 440,
        margin: '0 auto',
        animation: 'reviewFadeIn 0.6s ease-out both',
      }}
    >
      {/* Restaurant name */}
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 'clamp(28px, 7vw, 40px)',
          fontWeight: 600,
          textAlign: 'center',
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: '#111',
          margin: '0 0 0.5rem',
        }}
      >
        {restaurantName}
      </h1>

      {/* Decorative rule */}
      <div style={{
        width: 40,
        height: 1,
        background: '#D97706',
        margin: '1rem 0 1.25rem',
      }} />

      {/* Question */}
      <p style={{
        textAlign: 'center',
        fontSize: '1rem',
        lineHeight: 1.6,
        color: '#666',
        margin: '0 0 2rem',
        fontFamily: 'var(--font-sans)',
      }}>
        {t.starRating.howWasYourExperience}{' '}
        <span style={{ fontWeight: 600, color: '#111' }}>
          {staffName}
        </span>
        ?
      </p>

      {/* Stars */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '0.5rem',
        marginBottom: '1.5rem',
      }}>
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= displayRating;
          const isPopping = star === popStar;

          return (
            <button
              key={star}
              disabled={locked}
              onMouseEnter={() => !locked && setHoveredStar(star)}
              onMouseLeave={() => !locked && setHoveredStar(0)}
              onClick={() => handleSubmit(star)}
              aria-label={t.starRating.rateStars(star)}
              style={{
                border: 'none',
                background: 'transparent',
                padding: '0.5rem',
                cursor: locked ? 'default' : 'pointer',
                transition: 'transform 0.2s ease, filter 0.25s ease',
                transform: isFilled && !isPopping ? 'scale(1.1)' : 'scale(1)',
                filter: isFilled
                  ? 'drop-shadow(0 2px 12px rgba(217, 119, 6, 0.4))'
                  : 'none',
                color: isFilled ? '#D97706' : '#D4D4D4',
                opacity: locked && !isFilled ? 0.2 : 1,
                animation: isPopping ? 'starPop 0.35s ease-out' : 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <StarIcon filled={isFilled} size={48} />
            </button>
          );
        })}
      </div>

      {/* Hint / Error / Redirecting */}
      {error ? (
        <div style={{ textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              minHeight: 20,
              color: '#DC2626',
              fontWeight: 500,
              letterSpacing: '0.04em',
              marginBottom: '0.5rem',
            }}
          >
            {t.starRating.somethingWrong}
          </p>
          <button
            onClick={() => {
              setError(false);
              setSelectedStar(0);
              setHoveredStar(0);
              setPopStar(0);
            }}
            style={{
              border: '1px solid #111',
              borderRadius: 0,
              background: '#fff',
              color: '#111',
              fontWeight: 700,
              fontSize: '0.7rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '0.5rem 1.25rem',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {t.starRating.tryAgain}
          </button>
        </div>
      ) : redirecting ? (
        <div
          style={{
            textAlign: 'center',
            animation: 'reviewFadeIn 0.3s ease-out both',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.25rem',
              fontWeight: 600,
              color: '#111',
              margin: '0 0 0.35rem',
              letterSpacing: '-0.01em',
            }}
          >
            ¡Gracias por tu reseña!
          </p>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#666',
              margin: '0 0 0.9rem',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Te llevamos a Google…
          </p>
          <div
            style={{
              width: 120,
              height: 2,
              background: '#EEE',
              borderRadius: 2,
              overflow: 'hidden',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                height: '100%',
                background: '#D97706',
                animation: 'redirectProgress 1s linear forwards',
                transformOrigin: 'left',
              }}
            />
          </div>
        </div>
      ) : choice ? (
        <div style={{ textAlign: 'center', width: '100%', animation: 'reviewFadeIn 0.4s ease-out both' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 600, color: '#111', margin: '0 0 0.35rem', letterSpacing: '-0.01em' }}>
            ¡Gracias por tu calificación!
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 1.1rem', fontFamily: 'var(--font-sans)' }}>
            ¿Cómo te gustaría compartir tu experiencia?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {choice.googleReviewUrl && (
              <button onClick={chooseGoogle} style={CHOICE_BTN}>
                Dejar reseña en Google
              </button>
            )}
            <button onClick={chooseFeedback} style={CHOICE_BTN}>
              Enviar comentario privado
            </button>
          </div>
        </div>
      ) : (
        <p
          style={{
            textAlign: 'center',
            fontSize: '0.75rem',
            minHeight: 20,
            color: '#A3A3A3',
            fontWeight: 500,
            letterSpacing: '0.04em',
            transition: 'opacity 0.3s ease',
            animation: submitting ? 'pulseSoft 1.4s ease-in-out infinite' : 'none',
          }}
        >
          {submitting
            ? t.starRating.submittingRating
            : selectedStar === 0
              ? t.starRating.tapToRate
              : ''}
        </p>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes reviewFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes starPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.35); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1.1); }
        }
        @keyframes pulseSoft {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes redirectProgress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}

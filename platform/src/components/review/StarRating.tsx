'use client';

import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';
import { track } from '@/lib/analytics-client';
import {
  resolveReviewEntry,
  resolveSubmitOutcome,
  reviewResumeAnalyticsProperties,
  saveReviewSession,
} from '@/lib/review-session';

interface StarRatingProps {
  restaurantSlug: string;
  staffCode: string;
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

export interface ReviewChoice {
  reviewId: number;
  feedbackToken: string;
  googleReviewUrl: string | null;
}

export interface ReviewMountState {
  /** True when the guest already tapped a star and is resuming that review. */
  resumed: boolean;
  /** The rating to redraw, so the copy matches what the guest picked. 0 = fresh. */
  rating: number;
  /** The Google/private-feedback choice to offer, or null when the stars show. */
  choice: ReviewChoice | null;
}

/**
 * The whole mount path of the review screen, in one step: restore the cached
 * session (read-only — a restore never writes, so a reload loop can never
 * extend the 12 h window, and it validates shape, slug, TTL and link protocol)
 * and report the single `review_screen_shown` this mount owes analytics.
 *
 * It touches localStorage and analytics and NOTHING ELSE. In particular it never
 * fetches: the review row and its feedback token already exist from the star
 * tap, so re-POSTing on a reload would create a second review row and spend a
 * second slot of the guest's 3-per-device/24 h cap. Exported so that "a resume
 * calls nothing" is asserted rather than merely intended (see
 * review-resume.test.tsx); a DOM test renderer is not available to this suite.
 *
 * The token never reaches analytics: reviewResumeAnalyticsProperties() is the
 * only projection of a session that may be logged.
 */
export function resolveReviewMountState(
  restaurantSlug: string,
  staffCode: string,
): ReviewMountState {
  const entry = resolveReviewEntry(restaurantSlug);

  // A resume offers the choice instead of the stars, and `resumed: true`
  // separates the two populations in the funnel.
  track(
    'review_screen_shown',
    entry.kind === 'resume'
      ? { staff_code: staffCode || null, ...reviewResumeAnalyticsProperties(entry.session) }
      : { staff_code: staffCode || null },
    { restaurantSlug },
  );

  return entry.kind === 'resume'
    ? {
        resumed: true,
        rating: entry.session.rating,
        choice: {
          reviewId: entry.session.reviewId,
          feedbackToken: entry.session.feedbackToken,
          googleReviewUrl: entry.session.googleReviewUrl,
        },
      }
    : { resumed: false, rating: 0, choice: null };
}

/**
 * The remount boundary. A different slug is a different restaurant, and no part
 * of the screen belongs to the new one: keying on the slug discards the previous
 * instance whole — choice, rating, flags — instead of trying to unpick its state,
 * so a cached restaurant can never leave its still-valid review token's buttons
 * on the fresh restaurant's screen. Restore for the new slug is then established
 * by that instance's own mount effect.
 */
export default function StarRating(props: StarRatingProps) {
  return <StarRatingScreen key={props.restaurantSlug} {...props} />;
}

function StarRatingScreen({ restaurantSlug, staffCode, restaurantName }: StarRatingProps) {
  const router = useRouter();
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedStar, setSelectedStar] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [popStar, setPopStar] = useState(0);
  const [error, setError] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [storageChecked, setStorageChecked] = useState(false);
  const [showAlreadyReceived, setShowAlreadyReceived] = useState(false);
  const [choice, setChoice] = useState<ReviewChoice | null>(null);
  /** The slug this instance currently speaks for; see the submit guard below. */
  const activeSlug = useRef(restaurantSlug);
  /** The pending Google redirect, so leaving the screen can cancel it. */
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Restore, then decide, in one step (see review-resume.test.tsx). The star tap
    // already created the review and minted the feedback token; a reload or a
    // re-scan must land back on the Google/private-feedback choice for THAT review.
    const mount = resolveReviewMountState(restaurantSlug, staffCode);
    activeSlug.current = restaurantSlug;

    if (mount.choice) {
      setSelectedStar(mount.rating);
      setChoice(mount.choice);
    } else {
      // A fresh entry clears every field the previous restaurant could have set,
      // so the stars cannot sit under a heading whose screen still answers with
      // that restaurant's token.
      setChoice(null);
      setSelectedStar(0);
      setHoveredStar(0);
      setPopStar(0);
      setError(false);
      setShowAlreadyReceived(false);
      setSubmitting(false);
      setRedirecting(false);
    }

    // Exactly one review_screen_shown per mount, reported by the resolver above,
    // so review_page_open minus review_screen_shown keeps balancing.
    setStorageChecked(true);

    return () => {
      // The redirect is a plain timer, not React state: leaving the screen would
      // otherwise still send the guest to the previous restaurant's Google link.
      if (redirectTimer.current !== null) {
        clearTimeout(redirectTimer.current);
        redirectTimer.current = null;
      }
    };
  }, [restaurantSlug, staffCode]);

  const handleSubmit = useCallback(
    async (rating: number) => {
      // The slug this tap belongs to: the answer may arrive after the screen has
      // moved to another restaurant.
      const requestedSlug = restaurantSlug;
      // Whether an answer may repaint the screen at all: the guest can leave this
      // restaurant while the POST is in flight, and the screen that is up by then
      // is no longer the one this tap was about.
      const stillShowingRequestedSlug = () => activeSlug.current === requestedSlug;
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
        const outcome = resolveSubmitOutcome(data, { slug: restaurantSlug, rating });

        if (outcome.kind === 'invalid') throw new Error('Invalid submit response');

        if (outcome.kind === 'limited') {
          // The server's own 3-per-device/24 h cap. Terminal for this phone, and
          // no session: there is no review row to resume, so inventing one would
          // only fake a choice screen whose token authenticates nothing.
          if (stillShowingRequestedSlug()) {
            setSubmitting(false);
            setShowAlreadyReceived(true);
          }
          return;
        }

        // Persist BEFORE revealing the choice: a reload between the tap and the
        // choice must resume this exact review. save uses the original createdAt.
        // The write belongs to `requestedSlug` and stays correct even if this tap
        // is answered after the screen moved on.
        saveReviewSession(outcome.session);

        if (!stillShowingRequestedSlug()) return;

        // No rating-based routing: offer every guest the same two options and
        // let them choose (see chooseGoogle / chooseFeedback).
        setChoice({
          reviewId: outcome.session.reviewId,
          feedbackToken: outcome.session.feedbackToken,
          googleReviewUrl: outcome.session.googleReviewUrl,
        });
        setSubmitting(false);
      } catch {
        if (!stillShowingRequestedSlug()) return;
        setSubmitting(false);
        setSelectedStar(0);
        setPopStar(0);
        setError(true);
      }
    },
    [restaurantSlug, staffCode],
  );

  function chooseFeedback() {
    if (!choice) return;
    fetch('/api/reviews/chose-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: choice.reviewId, feedbackToken: choice.feedbackToken }),
    }).catch(() => {});
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
        ui_variant: 'hierarchy_v2',
      });
    }
    setRedirecting(true);
    redirectTimer.current = setTimeout(() => {
      redirectTimer.current = null;
      window.location.href = url;
    }, 800);
  }

  // Stars lock once submitted / a choice is shown / redirecting.
  const locked = submitting || choice !== null || redirecting;
  const displayRating = hoveredStar || selectedStar;

  const CHOICE_PRIMARY_BTN: CSSProperties = {
    width: '100%',
    padding: '0.95rem 1rem',
    border: 'none',
    borderRadius: 0,
    background: '#B45309',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.78rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  };

  const CHOICE_SECONDARY_BTN: CSSProperties = {
    width: '100%',
    padding: '0.95rem 1rem',
    border: '1px solid #DDD',
    borderRadius: 0,
    background: '#fff',
    color: '#666',
    fontWeight: 500,
    fontSize: '0.72rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  };

  if (!storageChecked) {
    return null;
  }

  if (showAlreadyReceived) {
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
          textAlign: 'center',
          animation: 'reviewFadeIn 0.4s ease-out both',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(28px, 7vw, 40px)',
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: '#111',
            margin: '0 0 1rem',
          }}
        >
          {restaurantName}
        </h1>
        <div style={{ width: 40, height: 1, background: '#D97706', marginBottom: '1.25rem' }} />
        <p
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.25rem',
            fontWeight: 600,
            color: '#111',
            margin: 0,
          }}
        >
          {t.starRating.alreadyReceived}
        </p>
        <style>{`
          @keyframes reviewFadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

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
        {t.starRating.howWasYourExperience(restaurantName)}
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
            ¡Gracias por su reseña!
          </p>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#666',
              margin: '0 0 0.9rem',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Abriendo Google…
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
            {selectedStar >= 4 ? '¡Qué gusto!' : '¡Gracias por su calificación!'}
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: '0 0 1.1rem', fontFamily: 'var(--font-sans)' }}>
            {selectedStar >= 4
              ? 'Su reseña en Google ayuda a otros comensales a encontrarnos.'
              : '¿Cómo le gustaría compartir su experiencia?'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {choice.googleReviewUrl && (
              <button onClick={chooseGoogle} style={CHOICE_PRIMARY_BTN}>
                Dejar mi reseña en Google
                <span style={{ fontSize: '0.65rem', fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', marginTop: '0.25rem' }}>
                  Pública · visible para otros comensales
                </span>
              </button>
            )}
            <button onClick={chooseFeedback} style={CHOICE_SECONDARY_BTN}>
              Enviar comentario privado al gerente
              <span style={{ fontSize: '0.65rem', textTransform: 'none', letterSpacing: 'normal', color: '#737373', marginTop: '0.25rem' }}>
                Queja o sugerencia · solo la lee la gerencia
              </span>
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

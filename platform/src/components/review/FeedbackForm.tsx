'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

interface FeedbackFormProps {
  restaurantName: string;
  restaurantSlug: string;
  reviewId: string | null;
}

function SuccessCheckmark() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 64 64"
      fill="none"
      style={{ animation: 'fbFadeIn 0.3s ease-out' }}
    >
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke="#059669"
        strokeWidth="2"
        strokeDasharray="176"
        strokeDashoffset="176"
        style={{ animation: 'drawCircle 0.7s ease-out 0.15s forwards' }}
      />
      <path
        d="M20 33 L28 41 L44 23"
        stroke="#059669"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="36"
        strokeDashoffset="36"
        style={{ animation: 'drawCheck 0.35s ease-out 0.7s forwards' }}
      />
    </svg>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#666',
  marginBottom: '0.4rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.75rem',
  border: '1px solid #111',
  borderRadius: 0,
  fontSize: '0.95rem',
  fontFamily: 'var(--font-sans)',
  background: '#fff',
  color: '#111',
  outline: 'none',
  transition: 'box-shadow 0.15s ease',
};

export default function FeedbackForm({
  restaurantName,
  reviewId,
}: FeedbackFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reviewId) return;
    setSubmitting(true);
    setError(false);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/reviews/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewId: parseInt(reviewId, 10),
          customerName: form.get('name') || undefined,
          customerEmail: form.get('email') || undefined,
          feedback: form.get('feedback'),
        }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.25rem',
          padding: '3rem 2rem',
          textAlign: 'center',
          animation: 'fbScaleIn 0.4s ease-out',
        }}
      >
        <SuccessCheckmark />
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.75rem',
            fontWeight: 600,
            color: '#111',
            letterSpacing: '-0.02em',
            marginTop: '0.5rem',
            animation: 'fbSlideUp 0.5s ease-out 0.6s both',
          }}
        >
          {t.feedbackForm.thankYou}
        </h1>
        <p
          style={{
            fontSize: '0.9rem',
            lineHeight: 1.6,
            color: '#666',
            maxWidth: 280,
            animation: 'fbSlideUp 0.5s ease-out 0.8s both',
          }}
        >
          {t.feedbackForm.feedbackShared(restaurantName)}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '2rem 1.75rem',
        animation: 'fbSlideUp 0.5s ease-out',
      }}
    >
      {/* Header */}
      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 'clamp(24px, 5vw, 32px)',
          fontWeight: 600,
          textAlign: 'center',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: '#111',
          margin: '0 0 0.5rem',
        }}
      >
        {restaurantName}
      </h1>

      <div style={{
        width: 32,
        height: 1,
        background: '#D97706',
        margin: '0.75rem auto 1rem',
      }} />

      <p
        style={{
          textAlign: 'center',
          fontSize: '0.85rem',
          lineHeight: 1.6,
          color: '#666',
          marginBottom: '1.75rem',
        }}
      >
        {t.feedbackForm.howToImprove}
      </p>

      {/* Error */}
      {error && (
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '1rem',
          border: '1px solid #DC2626',
          background: 'rgba(220,38,38,0.04)',
          color: '#DC2626',
          fontSize: '0.8rem',
          fontWeight: 500,
          textAlign: 'center',
        }}>
          {t.feedbackForm.somethingWrong}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label htmlFor="name" style={labelStyle}>
            {t.feedbackForm.name}{' '}
            <span style={{ color: '#A3A3A3', fontWeight: 500 }}>{t.feedbackForm.optional}</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder={t.feedbackForm.yourName}
            style={inputStyle}
            onFocus={(e) => { e.target.style.boxShadow = '0 0 0 2px rgba(217,119,6,0.15)'; }}
            onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div>
          <label htmlFor="email" style={labelStyle}>
            {t.feedbackForm.email}{' '}
            <span style={{ color: '#A3A3A3', fontWeight: 500 }}>{t.feedbackForm.optional}</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder={t.feedbackForm.yourEmail}
            style={inputStyle}
            onFocus={(e) => { e.target.style.boxShadow = '0 0 0 2px rgba(217,119,6,0.15)'; }}
            onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div>
          <label htmlFor="feedback" style={labelStyle}>
            {t.feedbackForm.whatCouldWeDoBetter}
          </label>
          <textarea
            id="feedback"
            name="feedback"
            required
            rows={4}
            placeholder={t.feedbackForm.tellUsAboutExperience}
            style={{
              ...inputStyle,
              resize: 'none',
            }}
            onFocus={(e) => { e.target.style.boxShadow = '0 0 0 2px rgba(217,119,6,0.15)'; }}
            onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            padding: '0.8rem',
            border: 'none',
            borderRadius: 0,
            background: '#111',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.7rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.6 : 1,
            transition: 'all 0.15s ease',
            fontFamily: 'var(--font-sans)',
            marginTop: '0.25rem',
          }}
        >
          {submitting ? t.feedbackForm.submitting : t.feedbackForm.shareFeedback}
        </button>
      </form>

      {/* Keyframes */}
      <style>{`
        @keyframes fbFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fbScaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes fbSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawCircle {
          to { stroke-dashoffset: 0; }
        }
        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

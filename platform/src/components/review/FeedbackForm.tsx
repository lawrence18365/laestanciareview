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
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
    >
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke="var(--success)"
        strokeWidth="2.5"
        strokeDasharray="176"
        strokeDashoffset="176"
        style={{ animation: 'drawCircle 0.7s ease-out 0.15s forwards' }}
      />
      <path
        d="M20 33 L28 41 L44 23"
        stroke="var(--success)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="36"
        strokeDashoffset="36"
        style={{ animation: 'drawCheck 0.35s ease-out 0.7s forwards' }}
      />
    </svg>
  );
}

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
        className="flex flex-col items-center gap-5 py-12 px-8 text-center"
        style={{ animation: 'scaleIn 0.4s ease-out' }}
      >
        <SuccessCheckmark />
        <h1
          className="text-3xl font-semibold mt-2"
          style={{
            fontFamily: 'var(--font-cormorant), Georgia, serif',
            animation: 'fadeInUp 0.5s ease-out 0.6s both',
          }}
        >
          {t.feedbackForm.thankYou}
        </h1>
        <p
          className="text-base leading-relaxed max-w-xs"
          style={{
            color: 'var(--stone-500)',
            animation: 'fadeInUp 0.5s ease-out 0.8s both',
          }}
        >
          {t.feedbackForm.feedbackShared(restaurantName)}
        </p>
      </div>
    );
  }

  const inputStyles: React.CSSProperties = {
    width: '100%',
    border: '1px solid var(--stone-200)',
    borderRadius: 12,
    padding: '13px 16px',
    fontSize: 16,
    color: 'var(--espresso)',
    background: 'var(--warm-white)',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    outline: 'none',
  };

  const inputFocusHandler = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--amber-500)';
    e.target.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.1)';
  };

  const inputBlurHandler = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--stone-200)';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div
      className="w-full max-w-md mx-auto px-6 py-10"
      style={{ animation: 'fadeInUp 0.5s ease-out' }}
    >
      {/* Header */}
      <h1
        className="text-[clamp(30px,6vw,40px)] font-semibold text-center leading-[1.1] mb-2"
        style={{
          fontFamily: 'var(--font-cormorant), Georgia, serif',
          letterSpacing: '-0.02em',
        }}
      >
        {restaurantName}
      </h1>

      <div
        className="mx-auto my-5"
        style={{
          width: 48,
          height: 1,
          background:
            'linear-gradient(90deg, transparent, var(--stone-300), transparent)',
        }}
      />

      <p
        className="text-center text-[15px] leading-relaxed mb-8"
        style={{ color: 'var(--stone-500)' }}
      >
        {t.feedbackForm.howToImprove}
      </p>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 500,
            background: '#fef2f2',
            color: '#dc2626',
            marginBottom: '1rem',
            textAlign: 'center',
          }}
        >
          {t.feedbackForm.somethingWrong}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--stone-700)' }}
          >
            {t.feedbackForm.name}{' '}
            <span style={{ color: 'var(--stone-400)', fontWeight: 400 }}>
              {t.feedbackForm.optional}
            </span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder={t.feedbackForm.yourName}
            style={inputStyles}
            onFocus={inputFocusHandler}
            onBlur={inputBlurHandler}
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--stone-700)' }}
          >
            {t.feedbackForm.email}{' '}
            <span style={{ color: 'var(--stone-400)', fontWeight: 400 }}>
              {t.feedbackForm.optional}
            </span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder={t.feedbackForm.yourEmail}
            style={inputStyles}
            onFocus={inputFocusHandler}
            onBlur={inputBlurHandler}
          />
        </div>

        <div>
          <label
            htmlFor="feedback"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--stone-700)' }}
          >
            {t.feedbackForm.whatCouldWeDoBetter}
          </label>
          <textarea
            id="feedback"
            name="feedback"
            required
            rows={4}
            placeholder={t.feedbackForm.tellUsAboutExperience}
            style={{
              ...inputStyles,
              resize: 'none',
            }}
            onFocus={inputFocusHandler}
            onBlur={inputBlurHandler}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-xl text-base font-medium transition-all duration-200"
          style={{
            background: 'var(--espresso)',
            color: 'var(--warm-white)',
            opacity: submitting ? 0.6 : 1,
            cursor: submitting ? 'default' : 'pointer',
            marginTop: 4,
          }}
          onMouseEnter={(e) => {
            if (!submitting) (e.target as HTMLElement).style.background = '#292524';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = 'var(--espresso)';
          }}
        >
          {submitting ? t.feedbackForm.submitting : t.feedbackForm.shareFeedback}
        </button>
      </form>
    </div>
  );
}

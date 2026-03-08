'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

const categories = [
  { value: 'bug', label: t.gmFeedback.bugReport, emoji: '🐛' },
  { value: 'feature', label: t.gmFeedback.featureRequest, emoji: '💡' },
  { value: 'feedback', label: t.gmFeedback.generalFeedback, emoji: '💬' },
  { value: 'question', label: t.gmFeedback.questionHelp, emoji: '❓' },
];

const card: React.CSSProperties = {
  background: 'var(--warm-white)',
  borderRadius: 10,
  padding: '2rem',
  boxShadow: 'var(--shadow-sm)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--stone-700)',
  marginBottom: '0.35rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.8rem',
  borderRadius: 8,
  border: '1px solid var(--stone-300)',
  fontSize: '0.9rem',
  background: 'var(--warm-white)',
  color: 'var(--espresso)',
};

interface Props {
  restaurantName: string;
  restaurantSlug: string;
}

export default function GMFeedbackForm({ restaurantName, restaurantSlug }: Props) {
  const [category, setCategory] = useState('feedback');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;

    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/auth/gm-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subject, message }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t.gmFeedback.failedToSend);
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.gmFeedback.somethingWrong);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div
          style={{
            ...card,
            textAlign: 'center',
            padding: '3rem 2rem',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✓</div>
          <h2
            style={{
              fontFamily: 'var(--font-cormorant), serif',
              fontSize: '1.5rem',
              fontWeight: 600,
              marginTop: 0,
              marginBottom: '0.5rem',
            }}
          >
            {t.gmFeedback.feedbackSent}
          </h2>
          <p style={{ color: 'var(--stone-500)', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
            {t.gmFeedback.thankYouRateTap}
          </p>
          <button
            onClick={() => {
              setSent(false);
              setCategory('feedback');
              setSubject('');
              setMessage('');
            }}
            style={{
              padding: '0.6rem 1.5rem',
              borderRadius: 8,
              border: '1px solid var(--stone-300)',
              background: 'transparent',
              color: 'var(--espresso)',
              fontWeight: 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {t.gmFeedback.sendAnother}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1
        style={{
          fontFamily: 'var(--font-cormorant), serif',
          fontSize: '1.5rem',
          fontWeight: 600,
          marginTop: 0,
          marginBottom: '0.25rem',
          color: 'var(--espresso)',
        }}
      >
        {t.gmFeedback.feedbackAndSupport}
      </h1>
      <p style={{ color: 'var(--stone-500)', fontSize: '0.85rem', marginTop: 0, marginBottom: '1.5rem' }}>
        {t.gmFeedback.reportBugsDescription}
      </p>

      <div style={card}>
        <form onSubmit={handleSubmit}>
          {/* Category pills */}
          <div style={{ marginBottom: '1.25rem' }}>
            <span style={labelStyle}>{t.gmFeedback.category}</span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: 8,
                    border: category === cat.value
                      ? '2px solid var(--espresso)'
                      : '1px solid var(--stone-300)',
                    background: category === cat.value ? 'var(--espresso)' : 'transparent',
                    color: category === cat.value ? 'var(--warm-white)' : 'var(--stone-700)',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle} htmlFor="subject">
              {t.gmFeedback.subject}{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--stone-400)' }}>
                {t.gmFeedback.optional}
              </span>
            </label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                category === 'bug'
                  ? t.gmFeedback.placeholderBugSubject
                  : category === 'feature'
                    ? t.gmFeedback.placeholderFeatureSubject
                    : t.gmFeedback.placeholderGenericSubject
              }
              style={inputStyle}
            />
          </div>

          {/* Message */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle} htmlFor="message">
              {category === 'bug' ? t.gmFeedback.whatHappened : t.gmFeedback.message}
            </label>
            <textarea
              id="message"
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                category === 'bug'
                  ? t.gmFeedback.placeholderBugMessage
                  : category === 'feature'
                    ? t.gmFeedback.placeholderFeatureMessage
                    : t.gmFeedback.placeholderGenericMessage
              }
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Sending from */}
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--stone-400)',
              marginBottom: '1rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--stone-100)',
              borderRadius: 6,
            }}
          >
            {t.gmFeedback.sendingAs} <strong style={{ color: 'var(--stone-700)' }}>{restaurantName}</strong> ({restaurantSlug})
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={sending || !message.trim()}
            style={{
              width: '100%',
              padding: '0.7rem',
              borderRadius: 8,
              border: 'none',
              background: 'var(--espresso)',
              color: 'var(--warm-white)',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: sending ? 'not-allowed' : 'pointer',
              opacity: sending || !message.trim() ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {sending ? t.gmFeedback.sending : t.gmFeedback.sendFeedback}
          </button>
        </form>
      </div>
    </div>
  );
}

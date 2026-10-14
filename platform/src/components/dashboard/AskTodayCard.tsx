'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { track } from '@/lib/analytics-client';
import { whatsappCustomersHref } from './QrShare';

/**
 * Daily pacing, not a bigger number: review bursts get filtered by Google, so
 * the card asks for 5 a day and says "listo" at 5. The button stays enabled.
 */
export const ASK_TODAY_TARGET = 5;

export type AskTodayPlacement = 'bienvenida' | 'dashboard';

// /bienvenida is a white sheet with hard-coded colors; the dashboard uses theme vars.
const PALETTES = {
  bienvenida: {
    border: '1px solid #1c1917',
    ink: '#1c1917',
    muted: '#57534e',
    buttonBg: '#1c1917',
    buttonInk: '#fff',
    done: '#15803d',
  },
  dashboard: {
    border: '1px solid var(--text-main)',
    ink: 'var(--text-main)',
    muted: 'var(--text-muted)',
    buttonBg: 'var(--text-main)',
    buttonInk: '#fff',
    done: '#15803d',
  },
} as const;

/**
 * The first action for a self-serve trial: send the generic review link
 * (`/r/{slug}`, same for every guest) to 5 customers of the day by WhatsApp.
 * `initialCount` is today's whatsapp_share_clicked count (America/Mexico_City
 * day) from the server; the browser adds one per tap.
 */
export function AskTodayCard({
  placement,
  restaurantName,
  reviewUrl,
  initialCount = 0,
  onShare,
}: {
  placement: AskTodayPlacement;
  restaurantName: string;
  reviewUrl: string;
  initialCount?: number;
  /** Extra per-screen tracking that ran before this card existed. */
  onShare?: () => void;
}) {
  const [count, setCount] = useState(initialCount);
  const p = PALETTES[placement];
  const done = count >= ASK_TODAY_TARGET;

  return (
    <section
      aria-label={t.askToday.title}
      style={{
        border: p.border,
        padding: '1rem',
        marginBottom: '1.25rem',
        textAlign: 'center',
        color: p.ink,
        background: 'transparent',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
        {t.askToday.title}
      </h2>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: p.muted }}>{t.askToday.helper}</p>
      <a
        href={whatsappCustomersHref(restaurantName, reviewUrl)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          onShare?.();
          track('whatsapp_share_clicked', { placement });
          setCount((n) => n + 1);
        }}
        style={{
          display: 'block',
          boxSizing: 'border-box',
          minHeight: 44,
          padding: '0.75rem',
          background: p.buttonBg,
          color: p.buttonInk,
          textDecoration: 'none',
          fontWeight: 700,
          fontSize: '0.85rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {t.askToday.button}
      </a>
      <p
        aria-live="polite"
        style={{
          margin: '0.6rem 0 0',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: done ? p.done : p.muted,
        }}
      >
        {done ? t.askToday.done : t.askToday.progress(count)}
      </p>
    </section>
  );
}

/**
 * "Reseñas en Google: 40 → 47 / +7 desde que entraste". Null (nothing to show)
 * with fewer than 2 snapshots or when the count did not grow: a flat or falling
 * count is never shown as an achievement.
 */
export function sinceJoinCounter(
  counts: { baseline: number; latest: number } | null | undefined,
): { baseline: number; latest: number; diff: number } | null {
  if (!counts) return null;
  const diff = counts.latest - counts.baseline;
  return diff > 0 ? { ...counts, diff } : null;
}

export function ReviewsSinceJoin({
  counts,
  style,
}: {
  counts: { baseline: number; latest: number } | null | undefined;
  style?: React.CSSProperties;
}) {
  const c = sinceJoinCounter(counts);
  if (!c) return null;
  return (
    <p style={{ margin: 0, fontSize: '0.9rem', textAlign: 'center', ...style }}>
      {t.askToday.googleReviews(c.baseline, c.latest)}{' '}
      <strong style={{ color: '#15803d' }}>{t.askToday.sinceJoined(c.diff)}</strong>
    </p>
  );
}

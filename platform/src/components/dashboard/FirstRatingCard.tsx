'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '@/lib/i18n';
import UpgradeCta from './UpgradeCta';

const seenKey = (slug: string) => `rt_first_rating_seen_${slug}`;

/**
 * One-time card for the first dashboard load with at least one rating.
 * "Seen" lives in localStorage, per restaurant. When storage is unavailable
 * the card stays hidden: a card we cannot remember showing would repeat on
 * every load.
 */
export default function FirstRatingCard({
  slug,
  plan,
  sentToGoogle,
}: {
  slug: string;
  plan: 'trial' | 'free';
  sentToGoogle: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let firstTime = false;
    try {
      if (window.localStorage.getItem(seenKey(slug)) !== '1') {
        window.localStorage.setItem(seenKey(slug), '1');
        firstTime = true;
      }
    } catch {
      firstTime = false;
    }
    if (firstTime) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Read client-only storage after hydration.
      setVisible(true);
    }
  }, [slug]);

  if (!visible) return null;

  return (
    <section
      className="flat-panel"
      style={{
        position: 'relative',
        padding: '1.25rem 3rem 1.25rem 1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem 1.5rem',
      }}
    >
      <p
        style={{
          margin: 0,
          color: 'var(--text-main)',
          fontFamily: 'var(--font-serif)',
          fontSize: '1.125rem',
          fontWeight: 600,
        }}
      >
        {t.upgrade.firstRating(sentToGoogle)}
      </p>
      {plan === 'free' ? (
        <UpgradeCta
          placement="first_rating"
          plan="free"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          {t.upgrade.activatePlan}
        </UpgradeCta>
      ) : (
        <UpgradeCta
          placement="first_rating"
          plan="trial"
          style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textDecoration: 'underline' }}
        >
          {t.upgrade.seePlans}
        </UpgradeCta>
      )}
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t.upgrade.close}
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

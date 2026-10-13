import { Lock } from 'lucide-react';
import { t } from '@/lib/i18n';
import UpgradeCta from './UpgradeCta';

/**
 * Inbox paywall: the count stays visible, the comment text does not exist on
 * this page. The caller passes a count only, never feedback rows.
 */
export default function LockedFeedbackCard({ count }: { count: number }) {
  return (
    <section
      aria-labelledby="locked-feedback-heading"
      className="flat-panel"
      style={{
        padding: '2rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.75rem',
        textAlign: 'center',
      }}
    >
      <Lock size={28} aria-hidden="true" color="var(--text-muted)" />
      <h2
        id="locked-feedback-heading"
        style={{
          margin: 0,
          color: 'var(--text-main)',
          fontFamily: 'var(--font-serif)',
          fontSize: '1.25rem',
          fontWeight: 600,
        }}
      >
        {t.upgrade.lockedFeedbackTitle(count)}
      </h2>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        {t.upgrade.lockedFeedbackBody}
      </p>
      <UpgradeCta
        placement="paywall_inbox"
        plan="free"
        className="btn btn-primary"
        style={{ textDecoration: 'none', marginTop: '0.25rem' }}
      >
        {t.upgrade.seePlans}
      </UpgradeCta>
    </section>
  );
}

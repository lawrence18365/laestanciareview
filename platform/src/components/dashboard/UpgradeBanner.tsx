import { t } from '@/lib/i18n';
import UpgradeCta from './UpgradeCta';
import type { UpgradeState } from './upgrade-state';

/** App-shell strip for self-serve restaurants: trial countdown or free plan. */
export default function UpgradeBanner({ upgrade }: { upgrade: UpgradeState | null | undefined }) {
  if (!upgrade) return null;

  const isTrial = upgrade.kind === 'trial';
  return (
    <UpgradeCta
      placement={isTrial ? 'banner_trial' : 'banner_free'}
      plan={isTrial ? 'trial' : 'free'}
      style={{
        display: 'block',
        padding: '0.65rem 1.25rem',
        background: 'var(--gold-light)',
        borderBottom: '1px solid var(--gold)',
        color: 'var(--text-main)',
        fontSize: '0.85rem',
        fontWeight: 500,
        lineHeight: 1.4,
        textAlign: 'center',
        textDecoration: 'none',
      }}
    >
      {isTrial ? t.upgrade.trialBanner(upgrade.daysLeft) : t.upgrade.freeBanner}
    </UpgradeCta>
  );
}

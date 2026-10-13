'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { track } from '@/lib/analytics-client';

export type UpgradePlacement =
  | 'banner_trial'
  | 'banner_free'
  | 'paywall_inbox'
  | 'paywall_maps'
  | 'first_rating';

/**
 * A link to /plan that reports `upgrade_prompt_shown` once when it mounts and
 * `upgrade_prompt_clicked` when pressed. Every upgrade surface renders one, so
 * the funnel is measured the same way everywhere.
 */
export default function UpgradeCta({
  placement,
  plan,
  children,
  className,
  style,
}: {
  placement: UpgradePlacement;
  plan: 'trial' | 'free';
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  useEffect(() => {
    track('upgrade_prompt_shown', { placement, plan });
  }, [placement, plan]);

  return (
    <Link
      href="/plan"
      className={className}
      style={style}
      onClick={() => track('upgrade_prompt_clicked', { placement, plan })}
    >
      {children}
    </Link>
  );
}

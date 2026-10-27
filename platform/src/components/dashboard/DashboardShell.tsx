'use client';

import { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import DashboardNav from './DashboardNav';
import OnboardingWizard from './OnboardingWizard';
import FeatureAnnouncementBanner from './FeatureAnnouncementBanner';
import PushNotificationBanner from './PushNotificationBanner';
import ProductAnalytics from './ProductAnalytics';
import UpgradeBanner from './UpgradeBanner';
import type { UpgradeState } from './upgrade-state';

export default function DashboardShell({
  restaurantName,
  logoSrc,
  logoDarkBg,
  newFeedbackCount,
  isOwner,
  isRegional,
  isStaff,
  isSolo,
  showEventsQuotes,
  slug,
  role,
  upgrade,
  children,
}: {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  newFeedbackCount: number;
  isOwner: boolean;
  isRegional?: boolean;
  isStaff?: boolean;
  /** team_mode === 'solo', read server-side from the restaurant row. */
  isSolo?: boolean;
  showEventsQuotes?: boolean;
  slug: string;
  role: 'gm' | 'owner' | 'regional';
  /** Self-serve trial countdown / free plan banner. Absent for Grupo restaurants. */
  upgrade?: UpgradeState | null;
  children: React.ReactNode;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const pathname = usePathname();
  const quoteFocus = pathname.startsWith('/quotes');

  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  return (
    <>
      <DashboardNav
        restaurantName={restaurantName}
        logoSrc={logoSrc}
        logoDarkBg={logoDarkBg}
        newFeedbackCount={newFeedbackCount}
        isOwner={isOwner}
        isRegional={isRegional}
        isStaff={isStaff}
        isSolo={isSolo}
        showEventsQuotes={showEventsQuotes}
        onOpenGuide={openGuide}
      />
      <UpgradeBanner upgrade={upgrade} />
      {!quoteFocus && <FeatureAnnouncementBanner slug={slug} />}
      {!quoteFocus && <PushNotificationBanner accountKey={slug} />}
      <ProductAnalytics slug={slug} role={role} />
      <main>{children}</main>
      <OnboardingWizard
        slug={slug}
        isOwner={isOwner}
        forceOpen={guideOpen}
        onClose={closeGuide}
      />
    </>
  );
}

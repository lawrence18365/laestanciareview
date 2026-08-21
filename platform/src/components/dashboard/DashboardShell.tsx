'use client';

import { useState, useCallback } from 'react';
import DashboardNav from './DashboardNav';
import OnboardingWizard from './OnboardingWizard';
import FeatureAnnouncementBanner from './FeatureAnnouncementBanner';
import PushNotificationBanner from './PushNotificationBanner';
import ProductAnalytics from './ProductAnalytics';

export default function DashboardShell({
  restaurantName,
  logoSrc,
  logoDarkBg,
  newFeedbackCount,
  isOwner,
  isRegional,
  slug,
  role,
  children,
}: {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  newFeedbackCount: number;
  isOwner: boolean;
  isRegional?: boolean;
  slug: string;
  role: 'gm' | 'owner' | 'regional';
  children: React.ReactNode;
}) {
  const [guideOpen, setGuideOpen] = useState(false);

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
        onOpenGuide={openGuide}
      />
      <FeatureAnnouncementBanner slug={slug} />
      <PushNotificationBanner slug={slug} />
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

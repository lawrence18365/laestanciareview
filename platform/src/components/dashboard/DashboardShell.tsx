'use client';

import { useState, useCallback } from 'react';
import DashboardNav from './DashboardNav';
import OnboardingWizard from './OnboardingWizard';

export default function DashboardShell({
  restaurantName,
  logoSrc,
  logoDarkBg,
  newFeedbackCount,
  isOwner,
  slug,
  children,
}: {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  newFeedbackCount: number;
  isOwner: boolean;
  slug: string;
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
        onOpenGuide={openGuide}
      />
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

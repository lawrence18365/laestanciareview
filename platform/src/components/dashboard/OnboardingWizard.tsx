'use client';

import { useState, useEffect, useCallback } from 'react';
import { t } from '@/lib/i18n';

/* ── Types ── */

interface Step {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  body: string;
  tip?: string;
}

/* ── Step visual palettes ── */

const palettes: Record<string, { bg: string; glow: string }> = {
  welcome: {
    bg: 'linear-gradient(145deg, #451A03 0%, #78350F 40%, #B45309 100%)',
    glow: 'radial-gradient(ellipse at 30% 70%, rgba(217,119,6,0.3) 0%, transparent 60%)',
  },
  'review-flow': {
    bg: 'linear-gradient(145deg, #431407 0%, #7C2D12 40%, #C2410C 100%)',
    glow: 'radial-gradient(ellipse at 70% 30%, rgba(249,115,22,0.25) 0%, transparent 60%)',
  },
  dashboard: {
    bg: 'linear-gradient(145deg, #042F2E 0%, #115E59 50%, #0D9488 100%)',
    glow: 'radial-gradient(ellipse at 40% 60%, rgba(20,184,166,0.25) 0%, transparent 60%)',
  },
  live: {
    bg: 'linear-gradient(145deg, #450A0A 0%, #991B1B 50%, #DC2626 100%)',
    glow: 'radial-gradient(ellipse at 60% 40%, rgba(239,68,68,0.25) 0%, transparent 60%)',
  },
  inbox: {
    bg: 'linear-gradient(145deg, #500724 0%, #9D174D 50%, #DB2777 100%)',
    glow: 'radial-gradient(ellipse at 50% 50%, rgba(236,72,153,0.2) 0%, transparent 60%)',
  },
  staff: {
    bg: 'linear-gradient(145deg, #052E16 0%, #166534 50%, #16A34A 100%)',
    glow: 'radial-gradient(ellipse at 30% 70%, rgba(34,197,94,0.2) 0%, transparent 60%)',
  },
  analytics: {
    bg: 'linear-gradient(145deg, #1E1B4B 0%, #3730A3 50%, #6366F1 100%)',
    glow: 'radial-gradient(ellipse at 60% 30%, rgba(99,102,241,0.25) 0%, transparent 60%)',
  },
  settings: {
    bg: 'linear-gradient(145deg, #0C0A09 0%, #292524 50%, #57534E 100%)',
    glow: 'radial-gradient(ellipse at 40% 60%, rgba(168,162,158,0.15) 0%, transparent 60%)',
  },
  whatsapp: {
    bg: 'linear-gradient(145deg, #064E3B 0%, #065F46 40%, #25D366 100%)',
    glow: 'radial-gradient(ellipse at 50% 50%, rgba(37,211,102,0.3) 0%, transparent 60%)',
  },
  ready: {
    bg: 'linear-gradient(145deg, #78350F 0%, #B45309 35%, #D97706 65%, #F59E0B 100%)',
    glow: 'radial-gradient(ellipse at 50% 50%, rgba(251,191,36,0.3) 0%, transparent 60%)',
  },
  overview: {
    bg: 'linear-gradient(145deg, #1E1B4B 0%, #4338CA 50%, #D97706 100%)',
    glow: 'radial-gradient(ellipse at 40% 60%, rgba(99,102,241,0.2) 0%, transparent 60%)',
  },
};

function getPalette(id: string) {
  return palettes[id] || palettes.welcome;
}

/* ── Step definitions ── */

const sandboxCode = process.env.NEXT_PUBLIC_TWILIO_SANDBOX_CODE || 'join ***';

const gmSteps: Step[] = [
  { id: 'welcome', icon: '★', title: t.onboarding.welcomeTitle, subtitle: t.onboarding.welcomeSubtitle, body: t.onboarding.welcomeBody, tip: t.onboarding.welcomeTip },
  { id: 'review-flow', icon: '📱', title: t.onboarding.reviewFlowTitle, subtitle: t.onboarding.reviewFlowSubtitle, body: t.onboarding.reviewFlowBody, tip: t.onboarding.reviewFlowTip },
  { id: 'dashboard', icon: '📊', title: t.onboarding.dashboardTitle, subtitle: t.onboarding.dashboardSubtitle, body: t.onboarding.dashboardBody },
  { id: 'live', icon: '⚡', title: t.onboarding.liveTitle, subtitle: t.onboarding.liveSubtitle, body: t.onboarding.liveBody, tip: t.onboarding.liveTip },
  { id: 'inbox', icon: '✉', title: t.onboarding.inboxTitle, subtitle: t.onboarding.inboxSubtitle, body: t.onboarding.inboxBody },
  { id: 'staff', icon: '👥', title: t.onboarding.staffTitle, subtitle: t.onboarding.staffSubtitle, body: t.onboarding.staffBody, tip: t.onboarding.staffTip },
  { id: 'analytics', icon: '📈', title: t.onboarding.analyticsTitle, subtitle: t.onboarding.analyticsSubtitle, body: t.onboarding.analyticsBody },
  { id: 'settings', icon: '⚙', title: t.onboarding.settingsTitle, subtitle: t.onboarding.settingsSubtitle, body: t.onboarding.settingsBody, tip: t.onboarding.settingsTip },
  { id: 'whatsapp', icon: '💬', title: t.onboarding.whatsappTitle, subtitle: t.onboarding.whatsappSubtitle, body: t.onboarding.whatsappBody, tip: t.onboarding.whatsappTip(sandboxCode) },
  { id: 'ready', icon: '🚀', title: t.onboarding.readyTitle, subtitle: t.onboarding.readySubtitle, body: t.onboarding.readyBody },
];

const ownerSteps: Step[] = [
  { id: 'welcome', icon: '★', title: t.onboarding.ownerWelcomeTitle, subtitle: t.onboarding.ownerWelcomeSubtitle, body: t.onboarding.ownerWelcomeBody },
  { id: 'overview', icon: '🏢', title: t.onboarding.overviewTitle, subtitle: t.onboarding.overviewSubtitle, body: t.onboarding.overviewBody, tip: t.onboarding.overviewTip },
  { id: 'analytics', icon: '📈', title: t.onboarding.ownerAnalyticsTitle, subtitle: t.onboarding.ownerAnalyticsSubtitle, body: t.onboarding.ownerAnalyticsBody },
  { id: 'settings', icon: '⚙', title: t.onboarding.ownerSettingsTitle, subtitle: t.onboarding.ownerSettingsSubtitle, body: t.onboarding.ownerSettingsBody },
  { id: 'ready', icon: '🚀', title: t.onboarding.ownerReadyTitle, subtitle: t.onboarding.ownerReadySubtitle, body: t.onboarding.ownerReadyBody },
];

/* ── Persistence ── */

function storageKey(slug: string, role: string) {
  return `ratetap_onboarding_${slug}_${role}`;
}

/* ── Component ── */

export default function OnboardingWizard({
  slug,
  isOwner,
  forceOpen,
  onClose,
}: {
  slug: string;
  isOwner: boolean;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const role = isOwner ? 'owner' : 'gm';
  const steps = isOwner ? ownerSteps : gmSteps;
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [contentKey, setContentKey] = useState(0);

  /* eslint-disable */
  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setVisible(true);
      return;
    }
    const done = localStorage.getItem(storageKey(slug, role));
    if (!done) setVisible(true);
  }, [slug, role, forceOpen]);
  /* eslint-enable */

  const close = useCallback(() => {
    localStorage.setItem(storageKey(slug, role), '1');
    setVisible(false);
    onClose?.();
  }, [slug, role, onClose]);

  const goTo = useCallback(
    (idx: number) => {
      if (transitioning || idx === step) return;
      setTransitioning(true);
      setTimeout(() => {
        setStep(idx);
        setContentKey((k) => k + 1);
        setTransitioning(false);
      }, 280);
    },
    [step, transitioning],
  );

  const next = useCallback(() => {
    if (step === steps.length - 1) close();
    else goTo(step + 1);
  }, [step, steps.length, close, goTo]);

  const prev = useCallback(() => {
    if (step > 0) goTo(step - 1);
  }, [step, goTo]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, next, prev, close]);

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;
  const progress = ((step + 1) / steps.length) * 100;
  const palette = getPalette(current.id);
  const stepNum = String(step + 1).padStart(2, '0');

  return (
    <>
      {/* ── Overlay ── */}
      <div
        className="onb-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="onb-card">
          {/* Progress bar */}
          <div className="onb-progress-track">
            <div
              className="onb-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* ── Visual Panel ── */}
          <div className="onb-visual" style={{ background: palette.bg }}>
            {/* Glow */}
            <div
              className="onb-visual-glow"
              style={{ background: palette.glow }}
            />

            {/* Transition cover — smooth gradient change */}
            <div key={contentKey} className="onb-visual-cover" />

            {/* Large decorative number */}
            <div className="onb-visual-num">{stepNum}</div>

            {/* Icon */}
            <div key={`icon-${contentKey}`} className="onb-visual-icon">
              {current.icon}
            </div>

            {/* Gold accent bar */}
            <div className="onb-visual-accent" />

            {/* Vertical step rail (desktop) */}
            <div className="onb-visual-rail">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`onb-rail-dot${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                  aria-label={`Paso ${i + 1}`}
                />
              ))}
            </div>
          </div>

          {/* ── Content Panel ── */}
          <div className="onb-content">
            {/* Header */}
            <div className="onb-header">
              <span className="onb-step-label">
                {t.onboarding.stepOf(step + 1, steps.length)}
              </span>
              <button
                className="onb-close"
                onClick={close}
                aria-label="Cerrar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                >
                  <path
                    d="M4 4L14 14M14 4L4 14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="square"
                  />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div
              key={contentKey}
              className={`onb-body ${transitioning ? 'exit' : 'enter'}`}
            >
              <h2 className="onb-title">{current.title}</h2>
              <p className="onb-subtitle">{current.subtitle}</p>
              <p className="onb-text">{current.body}</p>
              {current.tip && (
                <div className="onb-tip">
                  <div className="onb-tip-head">
                    <span className="onb-tip-icon">💡</span>
                    <span className="onb-tip-label">
                      {t.onboarding.tipLabel}
                    </span>
                  </div>
                  <p className="onb-tip-text">{current.tip}</p>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="onb-nav">
              {/* Horizontal dots (mobile) */}
              <div className="onb-dots">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`onb-dot${i === step ? ' active' : ''}`}
                    aria-label={`Paso ${i + 1}`}
                  />
                ))}
              </div>

              <div className="onb-buttons">
                {!isFirst ? (
                  <button className="onb-btn prev" onClick={prev}>
                    ← {t.onboarding.prev}
                  </button>
                ) : (
                  <div />
                )}
                <button className="onb-btn next" onClick={next}>
                  {isLast ? t.onboarding.finish : t.onboarding.next} →
                </button>
              </div>

              {!isLast && (
                <button className="onb-skip" onClick={close}>
                  {t.onboarding.skip}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Styles ── */}
      <style>{`
        /* ─── Overlay ─── */

        .onb-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(10, 10, 10, 0.82);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: onb-overlay-in 0.4s ease both;
          padding: 1rem;
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        /* ─── Card ─── */

        .onb-card {
          width: 100%;
          max-width: 940px;
          min-height: min(580px, 88vh);
          max-height: 92vh;
          display: flex;
          flex-direction: row;
          overflow: hidden;
          background: #FFFDF9;
          border: 2px solid #111;
          box-shadow: 16px 16px 0px rgba(0, 0, 0, 0.12);
          animation: onb-card-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.08s;
          position: relative;
        }

        /* ─── Progress ─── */

        .onb-progress-track {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: rgba(0, 0, 0, 0.06);
          z-index: 10;
        }

        .onb-progress-fill {
          height: 100%;
          background: #D97706;
          transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }

        /* ─── Visual Panel ─── */

        .onb-visual {
          width: 38%;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        /* Subtle grid pattern */
        .onb-visual::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(transparent 50%, rgba(255, 255, 255, 0.018) 50%),
            linear-gradient(90deg, transparent 50%, rgba(255, 255, 255, 0.018) 50%);
          background-size: 36px 36px;
          pointer-events: none;
        }

        /* Noise texture */
        .onb-visual::after {
          content: '';
          position: absolute;
          inset: 0;
          opacity: 0.18;
          pointer-events: none;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 128px 128px;
        }

        .onb-visual-glow {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
        }

        .onb-visual-cover {
          position: absolute;
          inset: 0;
          background: #000;
          z-index: 5;
          pointer-events: none;
          animation: onb-cover-blink 0.5s ease both;
        }

        .onb-visual-num {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 200px;
          font-weight: 800;
          font-style: italic;
          color: rgba(255, 255, 255, 0.05);
          line-height: 1;
          pointer-events: none;
          user-select: none;
          z-index: 2;
        }

        .onb-visual-icon {
          font-size: 4.5rem;
          line-height: 1;
          position: relative;
          z-index: 3;
          filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.35));
          animation: onb-icon-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.1s;
        }

        .onb-visual-accent {
          width: 32px;
          height: 2px;
          background: rgba(217, 119, 6, 0.5);
          margin-top: 20px;
          position: relative;
          z-index: 3;
        }

        /* Vertical step rail */
        .onb-visual-rail {
          position: absolute;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          gap: 10px;
          z-index: 6;
        }

        .onb-rail-dot {
          width: 8px;
          height: 8px;
          border: 1.5px solid rgba(255, 255, 255, 0.35);
          background: transparent;
          cursor: pointer;
          padding: 0;
          transition: all 0.3s ease;
        }

        .onb-rail-dot.active {
          background: #fff;
          border-color: #fff;
          transform: scale(1.5);
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
        }

        .onb-rail-dot.done {
          background: rgba(255, 255, 255, 0.45);
          border-color: rgba(255, 255, 255, 0.45);
        }

        .onb-rail-dot:hover {
          border-color: #fff;
          transform: scale(1.3);
        }

        /* ─── Content Panel ─── */

        .onb-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }

        .onb-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.75rem 2.25rem 0;
          flex-shrink: 0;
        }

        .onb-step-label {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #A8A29E;
          font-family: 'Outfit', sans-serif;
        }

        .onb-close {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: 1px solid transparent;
          cursor: pointer;
          color: #A8A29E;
          transition: all 0.2s ease;
          padding: 0;
        }

        .onb-close:hover {
          color: #1C1917;
          border-color: #1C1917;
        }

        /* ─── Body ─── */

        .onb-body {
          padding: 1.5rem 2.25rem 1.75rem;
          flex: 1;
          overflow-y: auto;
          min-height: 0;
        }

        .onb-body.exit {
          animation: onb-body-exit 0.22s ease both;
        }

        .onb-body.enter .onb-title {
          animation: onb-stagger 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.06s;
        }

        .onb-body.enter .onb-subtitle {
          animation: onb-stagger 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.13s;
        }

        .onb-body.enter .onb-text {
          animation: onb-stagger 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.20s;
        }

        .onb-body.enter .onb-tip {
          animation: onb-stagger 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.28s;
        }

        .onb-title {
          margin: 0 0 0.5rem;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 2rem;
          font-weight: 600;
          color: #1C1917;
          line-height: 1.15;
          letter-spacing: -0.025em;
        }

        .onb-subtitle {
          margin: 0 0 1.5rem;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #D97706;
          font-family: 'Outfit', sans-serif;
        }

        .onb-text {
          margin: 0;
          font-size: 0.9375rem;
          line-height: 1.72;
          color: #57534E;
          font-family: 'Outfit', sans-serif;
        }

        /* ─── Tip ─── */

        .onb-tip {
          margin-top: 1.75rem;
          padding: 1.125rem 1.375rem;
          background: linear-gradient(135deg, rgba(217, 119, 6, 0.06) 0%, rgba(217, 119, 6, 0.02) 100%);
          border-left: 3px solid #D97706;
        }

        .onb-tip-head {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
        }

        .onb-tip-icon {
          font-size: 0.85rem;
          line-height: 1;
        }

        .onb-tip-label {
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #D97706;
          font-family: 'Outfit', sans-serif;
        }

        .onb-tip-text {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.65;
          color: #44403C;
          font-family: 'Outfit', sans-serif;
        }

        /* ─── Navigation ─── */

        .onb-nav {
          padding: 0 2.25rem 2rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          flex-shrink: 0;
        }

        .onb-dots {
          display: none;
          justify-content: center;
          gap: 6px;
        }

        .onb-dot {
          width: 8px;
          height: 8px;
          background: #E2E2E2;
          border: none;
          cursor: pointer;
          padding: 0;
          transition: all 0.3s ease;
        }

        .onb-dot.active {
          width: 28px;
          background: #D97706;
        }

        .onb-dot:hover {
          background: #B45309;
        }

        .onb-buttons {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .onb-btn {
          padding: 0.75rem 1.5rem;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: 'Outfit', sans-serif;
          border: none;
        }

        .onb-btn.prev {
          background: transparent;
          color: #1C1917;
          border: 1px solid #1C1917;
        }

        .onb-btn.prev:hover {
          background: #1C1917;
          color: #FFFDF9;
        }

        .onb-btn.next {
          background: #1C1917;
          color: #FFFDF9;
        }

        .onb-btn.next:hover {
          background: #D97706;
        }

        .onb-skip {
          background: none;
          border: none;
          color: #A8A29E;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          text-align: center;
          padding: 0.25rem;
          font-family: 'Outfit', sans-serif;
          transition: color 0.2s ease;
        }

        .onb-skip:hover {
          color: #57534E;
        }

        /* ─── Keyframes ─── */

        @keyframes onb-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes onb-card-in {
          from { opacity: 0; transform: scale(0.96) translateY(16px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        @keyframes onb-stagger {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes onb-body-exit {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes onb-icon-in {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes onb-cover-blink {
          0% { opacity: 0; }
          35% { opacity: 0.5; }
          100% { opacity: 0; }
        }

        /* ─── Responsive: Mobile ─── */

        @media (max-width: 768px) {
          .onb-overlay {
            padding: 0;
            align-items: stretch;
          }

          .onb-card {
            flex-direction: column;
            max-width: 100%;
            max-height: 100%;
            min-height: 100vh;
            min-height: 100dvh;
            border: none;
            box-shadow: none;
          }

          .onb-visual {
            width: 100%;
            min-height: 190px;
            max-height: 200px;
            flex-shrink: 0;
          }

          .onb-visual-num {
            font-size: 110px;
          }

          .onb-visual-icon {
            font-size: 3rem;
          }

          .onb-visual-accent {
            margin-top: 12px;
          }

          .onb-visual-rail {
            display: none;
          }

          .onb-dots {
            display: flex;
          }

          .onb-header {
            padding: 1.25rem 1.25rem 0;
          }

          .onb-body {
            padding: 1rem 1.25rem 1.25rem;
          }

          .onb-title {
            font-size: 1.5rem;
          }

          .onb-text {
            font-size: 0.875rem;
            line-height: 1.65;
          }

          .onb-tip {
            margin-top: 1.25rem;
            padding: 0.875rem 1rem;
          }

          .onb-tip-text {
            font-size: 0.8125rem;
          }

          .onb-nav {
            padding: 0 1.25rem 1.5rem;
          }

          .onb-btn {
            padding: 0.7rem 1.25rem;
          }

          .onb-progress-track {
            height: 2px;
          }
        }

        /* ─── Small height screens ─── */

        @media (max-height: 600px) {
          .onb-visual {
            min-height: 140px;
            max-height: 150px;
          }

          .onb-visual-num {
            font-size: 80px;
          }

          .onb-visual-icon {
            font-size: 2.5rem;
          }

          .onb-body {
            padding-top: 0.75rem;
            padding-bottom: 1rem;
          }

          .onb-title {
            font-size: 1.35rem;
            margin-bottom: 0.25rem;
          }

          .onb-subtitle {
            margin-bottom: 1rem;
          }

          .onb-tip {
            margin-top: 1rem;
          }
        }
      `}</style>
    </>
  );
}

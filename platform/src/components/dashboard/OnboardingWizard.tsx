'use client';

import { useState, useEffect, useCallback } from 'react';
import { t } from '@/lib/i18n';

/* ── Step definitions ── */

interface Step {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  body: string;
  tip?: string;
}

const gmSteps: Step[] = [
  {
    id: 'welcome',
    icon: '★',
    title: t.onboarding.welcomeTitle,
    subtitle: t.onboarding.welcomeSubtitle,
    body: t.onboarding.welcomeBody,
    tip: t.onboarding.welcomeTip,
  },
  {
    id: 'review-flow',
    icon: '📱',
    title: t.onboarding.reviewFlowTitle,
    subtitle: t.onboarding.reviewFlowSubtitle,
    body: t.onboarding.reviewFlowBody,
    tip: t.onboarding.reviewFlowTip,
  },
  {
    id: 'dashboard',
    icon: '📊',
    title: t.onboarding.dashboardTitle,
    subtitle: t.onboarding.dashboardSubtitle,
    body: t.onboarding.dashboardBody,
  },
  {
    id: 'live',
    icon: '⚡',
    title: t.onboarding.liveTitle,
    subtitle: t.onboarding.liveSubtitle,
    body: t.onboarding.liveBody,
    tip: t.onboarding.liveTip,
  },
  {
    id: 'inbox',
    icon: '✉',
    title: t.onboarding.inboxTitle,
    subtitle: t.onboarding.inboxSubtitle,
    body: t.onboarding.inboxBody,
  },
  {
    id: 'staff',
    icon: '👥',
    title: t.onboarding.staffTitle,
    subtitle: t.onboarding.staffSubtitle,
    body: t.onboarding.staffBody,
    tip: t.onboarding.staffTip,
  },
  {
    id: 'analytics',
    icon: '📈',
    title: t.onboarding.analyticsTitle,
    subtitle: t.onboarding.analyticsSubtitle,
    body: t.onboarding.analyticsBody,
  },
  {
    id: 'settings',
    icon: '⚙',
    title: t.onboarding.settingsTitle,
    subtitle: t.onboarding.settingsSubtitle,
    body: t.onboarding.settingsBody,
    tip: t.onboarding.settingsTip,
  },
  {
    id: 'ready',
    icon: '🚀',
    title: t.onboarding.readyTitle,
    subtitle: t.onboarding.readySubtitle,
    body: t.onboarding.readyBody,
  },
];

const ownerSteps: Step[] = [
  {
    id: 'welcome',
    icon: '★',
    title: t.onboarding.ownerWelcomeTitle,
    subtitle: t.onboarding.ownerWelcomeSubtitle,
    body: t.onboarding.ownerWelcomeBody,
  },
  {
    id: 'overview',
    icon: '🏢',
    title: t.onboarding.overviewTitle,
    subtitle: t.onboarding.overviewSubtitle,
    body: t.onboarding.overviewBody,
    tip: t.onboarding.overviewTip,
  },
  {
    id: 'analytics',
    icon: '📈',
    title: t.onboarding.ownerAnalyticsTitle,
    subtitle: t.onboarding.ownerAnalyticsSubtitle,
    body: t.onboarding.ownerAnalyticsBody,
  },
  {
    id: 'settings',
    icon: '⚙',
    title: t.onboarding.ownerSettingsTitle,
    subtitle: t.onboarding.ownerSettingsSubtitle,
    body: t.onboarding.ownerSettingsBody,
  },
  {
    id: 'ready',
    icon: '🚀',
    title: t.onboarding.ownerReadyTitle,
    subtitle: t.onboarding.ownerReadySubtitle,
    body: t.onboarding.ownerReadyBody,
  },
];

/* ── Persistence key ── */

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
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setVisible(true);
      return;
    }
    const done = localStorage.getItem(storageKey(slug, role));
    if (!done) {
      setVisible(true);
    }
  }, [slug, role, forceOpen]);

  const close = useCallback(() => {
    localStorage.setItem(storageKey(slug, role), '1');
    setVisible(false);
    onClose?.();
  }, [slug, role, onClose]);

  const goTo = useCallback((idx: number) => {
    if (animating) return;
    setDirection(idx > step ? 'next' : 'prev');
    setAnimating(true);
    setTimeout(() => {
      setStep(idx);
      setAnimating(false);
    }, 200);
  }, [step, animating]);

  const next = useCallback(() => {
    if (step === steps.length - 1) {
      close();
    } else {
      goTo(step + 1);
    }
  }, [step, steps.length, close, goTo]);

  const prev = useCallback(() => {
    if (step > 0) goTo(step - 1);
  }, [step, goTo]);

  // Keyboard navigation
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        animation: 'onb-overlay-in 0.3s ease both',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--panel-bg)',
          border: '2px solid var(--border-dark)',
          boxShadow: '12px 12px 0px rgba(0,0,0,0.1)',
          position: 'relative',
        }}
      >
        {/* Progress bar */}
        <div style={{
          height: 3,
          background: 'var(--panel-border)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${progress}%`,
            background: 'var(--text-main)',
            transition: 'width 0.4s ease',
          }} />
        </div>

        {/* Close button */}
        <button
          onClick={close}
          aria-label="Cerrar"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: '1px solid var(--panel-border)',
            cursor: 'pointer',
            fontSize: '1rem',
            color: 'var(--text-dim)',
            transition: 'all 0.15s ease',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-dark)';
            e.currentTarget.style.color = 'var(--text-main)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--panel-border)';
            e.currentTarget.style.color = 'var(--text-dim)';
          }}
        >
          ✕
        </button>

        {/* Step counter */}
        <div style={{
          padding: '1.5rem 2rem 0',
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}>
          {t.onboarding.stepOf(step + 1, steps.length)}
        </div>

        {/* Content area */}
        <div
          key={step}
          style={{
            padding: '1.25rem 2rem 1.5rem',
            animation: animating
              ? `onb-slide-out-${direction} 0.2s ease both`
              : `onb-slide-in-${direction} 0.3s ease both`,
          }}
        >
          {/* Icon */}
          <div style={{
            width: 56,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.75rem',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-dark)',
            marginBottom: '1.25rem',
          }}>
            {current.icon}
          </div>

          {/* Title */}
          <h2 style={{
            margin: '0 0 0.25rem',
            fontSize: '1.75rem',
            fontWeight: 600,
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-main)',
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}>
            {current.title}
          </h2>

          {/* Subtitle */}
          <p style={{
            margin: '0 0 1.25rem',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}>
            {current.subtitle}
          </p>

          {/* Body */}
          <p style={{
            margin: 0,
            fontSize: '0.9375rem',
            lineHeight: 1.65,
            color: 'var(--text-muted)',
          }}>
            {current.body}
          </p>

          {/* Tip callout */}
          {current.tip && (
            <div style={{
              marginTop: '1.25rem',
              padding: '1rem 1.25rem',
              background: 'var(--gold-light)',
              borderLeft: '3px solid var(--gold)',
            }}>
              <p style={{
                margin: '0 0 0.25rem',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
              }}>
                {t.onboarding.tipLabel}
              </p>
              <p style={{
                margin: 0,
                fontSize: '0.875rem',
                lineHeight: 1.55,
                color: 'var(--text-main)',
              }}>
                {current.tip}
              </p>
            </div>
          )}
        </div>

        {/* Step dots + Navigation */}
        <div style={{
          padding: '0 2rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}>
          {/* Dot indicators */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
          }}>
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Paso ${i + 1}`}
                style={{
                  width: i === step ? 24 : 8,
                  height: 8,
                  background: i === step ? 'var(--text-main)' : 'var(--panel-border)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Buttons */}
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'space-between',
          }}>
            {!isFirst ? (
              <button
                onClick={prev}
                style={{
                  padding: '0.65rem 1.25rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: 'var(--panel-bg)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-dark)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-base)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--panel-bg)';
                }}
              >
                ← {t.onboarding.prev}
              </button>
            ) : (
              <div />
            )}

            <button
              onClick={next}
              style={{
                padding: '0.65rem 1.5rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: 'var(--text-main)',
                color: 'var(--panel-bg)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontFamily: 'var(--font-sans)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#333';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--text-main)';
              }}
            >
              {isLast ? t.onboarding.finish : t.onboarding.next} →
            </button>
          </div>

          {/* Skip link */}
          {!isLast && (
            <button
              onClick={close}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: '0.65rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                textAlign: 'center',
                padding: '0.25rem',
              }}
            >
              {t.onboarding.skip}
            </button>
          )}
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes onb-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes onb-slide-in-next {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes onb-slide-out-next {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(-30px); }
        }
        @keyframes onb-slide-in-prev {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes onb-slide-out-prev {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(30px); }
        }
      `}</style>
    </div>
  );
}

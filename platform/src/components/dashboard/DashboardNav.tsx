'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { t } from '@/lib/i18n';
import { revokeDeviceOnLogout } from '@/lib/push-client';

const gmLinks = [
  { href: '/dashboard', label: t.nav.dashboard },
  { href: '/live', label: t.nav.live },
  { href: '/inbox', label: t.nav.inbox, badge: true },
  { href: '/guests', label: t.nav.guests },
  { href: '/campaigns', label: t.nav.campaigns },
  { href: '/leads', label: t.nav.leads, eventsQuotes: true },
  { href: '/quotes', label: t.nav.quotes, eventsQuotes: true },
  { href: '/staff', label: t.nav.staff },
  { href: '/qr-codes', label: t.nav.qrCodes },
  { href: '/analytics', label: t.nav.analytics },
  { href: '/settings', label: t.nav.settings },
];

const ownerLinks = [
  { href: '/overview', label: t.nav.overview },
  { href: '/insights', label: 'Insights' },
  { href: '/settings', label: t.nav.settings },
];

// RateTap-internal sales tooling: only shown when the server says the session
// is RateTap staff (isRateTapStaff). Never part of a customer's nav.
const staffLinks = [
  { href: '/commercial-leads', label: 'Comercial' },
  { href: '/prospects', label: 'Prospectos' },
];

const regionalLinks = [
  { href: '/overview', label: t.nav.overview },
  { href: '/settings', label: t.nav.settings },
];

// Solo mode (team_mode = 'solo'): guest capture and campaigns need staff to
// redeem, so v1 hides them, and "Personal" moves out of the primary nav into a
// link in Settings. NULL / team keeps the full GM nav.
const SOLO_HIDDEN_HREFS = new Set(['/guests', '/campaigns', '/staff']);

export function navLinksFor({
  isOwner,
  isRegional,
  isSolo,
  showEventsQuotes,
  isStaff,
}: {
  isOwner?: boolean;
  isRegional?: boolean;
  isSolo?: boolean;
  showEventsQuotes?: boolean;
  isStaff?: boolean;
}) {
  const baseLinks = isRegional ? regionalLinks : isOwner ? ownerLinks : gmLinks;
  const visibleLinks = baseLinks
    .filter((link) => showEventsQuotes || !('eventsQuotes' in link))
    .filter((link) => !(isSolo && !isOwner && !isRegional && SOLO_HIDDEN_HREFS.has(link.href)));
  return isStaff ? [...visibleLinks, ...staffLinks] : visibleLinks;
}

export default function DashboardNav({
  restaurantName,
  logoSrc: _logoSrc,
  logoDarkBg: _logoDarkBg,
  newFeedbackCount,
  isOwner,
  isRegional,
  isStaff,
  isSolo,
  showEventsQuotes,
  onOpenGuide,
}: {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  newFeedbackCount?: number;
  isOwner?: boolean;
  isRegional?: boolean;
  isStaff?: boolean;
  /** Server-derived from the restaurant row (team_mode === 'solo'). */
  isSolo?: boolean;
  /** Leads and quotes links are shown only for La Estancia (see hasEventsQuotes). */
  showEventsQuotes?: boolean;
  onOpenGuide?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const navLinks = navLinksFor({ isOwner, isRegional, isSolo, showEventsQuotes, isStaff });
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    // Revoke this device's alert registration first: the account is leaving, and
    // the next account to sign in on this device would otherwise hit a 409
    // device conflict against the endpoint left behind. Bounded, never throws.
    await revokeDeviceOnLogout();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* continue */ }
    router.push('/login');
  }

  return (
    <>
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.25rem',
        paddingTop: 'var(--safe-top)',
        height: 'var(--app-nav-h)',
        boxSizing: 'border-box',
        background: 'var(--panel-bg)',
        borderBottom: '2px solid var(--border-dark)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        {/* Left: Logo + Name */}
        <a
          href={isOwner ? '/overview' : '/dashboard'}
          style={{
            display: 'flex',
            minWidth: 0,
            flexShrink: 1,
            alignItems: 'center',
            gap: '0.75rem',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <img
            src="/logos/ratetap_logo_transparent_background.png"
            alt="RateTap"
            style={{ height: 44, objectFit: 'contain', flexShrink: 0 }}
          />
          <p style={{
            margin: 0,
            fontSize: '0.6rem',
            fontWeight: 600,
            color: 'var(--text-dim)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            maxWidth: 'clamp(72px, 13vw, 150px)',
            minWidth: 0,
            flexShrink: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {restaurantName}
          </p>
        </a>

        {/* Center: Desktop nav links */}
        <div className="nav-links" style={{ alignItems: 'center', minWidth: 0, flex: '1 1 0%', margin: '0 12px', overflowX: 'auto', overflowY: 'hidden', overscrollBehaviorX: 'contain', scrollbarWidth: 'none' }}>
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a
                key={link.href}
                href={link.href}
                style={{
                  padding: '0.35rem 0.75rem',
                  minHeight: 44,
                  fontSize: '0.7rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--panel-bg)' : 'var(--text-muted)',
                  textDecoration: 'none',
                  background: active ? 'var(--text-main)' : 'transparent',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {link.label}
                {badgeCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: '0.55rem',
                    fontWeight: 700,
                    minWidth: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </a>
            );
          })}
        </div>

        {/* Right: Guide + Sign out */}
        <div className="nav-links" style={{ alignItems: 'center', gap: '0.5rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {onOpenGuide && (
            <button
              onClick={onOpenGuide}
              style={{
                fontSize: '0.65rem',
                padding: '0.3rem 0.75rem',
                minHeight: 44,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'var(--panel-bg)',
                color: 'var(--gold)',
                border: '1px solid var(--gold)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--gold)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--panel-bg)';
                e.currentTarget.style.color = 'var(--gold)';
              }}
            >
              ?&ensp;{t.onboarding.helpButton}
            </button>
          )}
          <button
            onClick={handleLogout}
            style={{
              fontSize: '0.65rem',
              padding: '0.3rem 0.75rem',
              minHeight: 44,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'var(--panel-bg)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-dark)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--text-main)';
              e.currentTarget.style.color = 'var(--panel-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--panel-bg)';
              e.currentTarget.style.color = 'var(--text-main)';
            }}
          >
            {t.nav.signOut}
          </button>
        </div>

        {/* Mobile: Hamburger */}
        <button
          className="nav-mobile-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            width: 44,
            height: 44,
            minWidth: 44,
            minHeight: 44,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxSizing: 'border-box',
            gap: '4px',
          }}
          aria-label="Menu"
        >
          <span style={{
            width: 20, height: 2, background: 'var(--text-main)',
            transition: 'all 0.2s',
            transform: mobileOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none',
          }} />
          <span style={{
            width: 20, height: 2, background: 'var(--text-main)',
            transition: 'all 0.2s',
            opacity: mobileOpen ? 0 : 1,
          }} />
          <span style={{
            width: 20, height: 2, background: 'var(--text-main)',
            transition: 'all 0.2s',
            transform: mobileOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none',
          }} />
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="nav-mobile-menu">
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a
                key={link.href}
                href={link.href}
                style={{
                  minHeight: 44,
                  boxSizing: 'border-box',
                  padding: '0.6rem 1.25rem',
                  fontSize: '0.75rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--panel-bg)' : 'var(--text-main)',
                  textDecoration: 'none',
                  background: active ? 'var(--text-main)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
                {badgeCount > 0 && (
                  <span style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: '0.55rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {badgeCount}
                  </span>
                )}
              </a>
            );
          })}
          {onOpenGuide && (
            <button
              onClick={() => { setMobileOpen(false); onOpenGuide(); }}
              style={{
                margin: '0.5rem 1.25rem 0',
                minHeight: 44,
                boxSizing: 'border-box',
                padding: '0.5rem 0.75rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--gold)',
                background: 'none',
                border: '1px solid var(--gold)',
                textAlign: 'left',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              ? {t.onboarding.helpButton}
            </button>
          )}
          <button
            onClick={handleLogout}
            className="nav-signout-mobile"
            style={{
              margin: '0.5rem 1.25rem',
              minHeight: 44,
              boxSizing: 'border-box',
              padding: '0.5rem 0.75rem',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--red)',
              background: 'none',
              border: `1px solid var(--red)`,
              textAlign: 'left',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {t.nav.signOut}
          </button>
        </div>
      )}
    </>
  );
}

'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { t } from '@/lib/i18n';

const gmLinks = [
  { href: '/dashboard', label: t.nav.dashboard },
  { href: '/live', label: t.nav.live },
  { href: '/inbox', label: t.nav.inbox, badge: true },
  { href: '/staff', label: t.nav.staff },
  { href: '/analytics', label: t.nav.analytics },
  { href: '/settings', label: t.nav.settings },
];

const ownerLinks = [
  { href: '/overview', label: t.nav.overview },
  { href: '/analytics', label: t.nav.analytics },
  { href: '/settings', label: t.nav.settings },
];

export default function DashboardNav({
  restaurantName,
  logoSrc,
  logoDarkBg,
  newFeedbackCount,
  isOwner,
}: {
  restaurantName: string;
  logoSrc: string;
  logoDarkBg: boolean;
  newFeedbackCount?: number;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const navLinks = isOwner ? ownerLinks : gmLinks;
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
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
        height: 56,
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
            alignItems: 'center',
            gap: '0.75rem',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{
            width: 32,
            height: 32,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <img
              src="/logos/logo.png"
              alt="RateTap"
              style={{ height: 32, width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              fontFamily: 'var(--font-serif)',
            }}>
              RateTap
            </p>
            <p style={{
              margin: 0,
              fontSize: '0.6rem',
              fontWeight: 600,
              color: 'var(--text-dim)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              {restaurantName}
            </p>
          </div>
        </a>

        {/* Center: Desktop nav links */}
        <div className="nav-links" style={{ alignItems: 'center' }}>
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a
                key={link.href}
                href={link.href}
                style={{
                  padding: '0.35rem 0.875rem',
                  fontSize: '0.7rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--panel-bg)' : 'var(--text-muted)',
                  textDecoration: 'none',
                  background: active ? 'var(--text-main)' : 'transparent',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
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

        {/* Right: Desktop sign out */}
        <button
          onClick={handleLogout}
          className="nav-links"
          style={{
            fontSize: '0.65rem',
            padding: '0.3rem 0.75rem',
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

        {/* Mobile: Hamburger */}
        <button
          className="nav-mobile-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
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
          <button
            onClick={handleLogout}
            className="nav-signout-mobile"
            style={{
              margin: '0.5rem 1.25rem',
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
            }}
          >
            {t.nav.signOut}
          </button>
        </div>
      )}
    </>
  );
}

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

  const linkStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.4rem 0.75rem',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-main)' : 'var(--text-muted)',
    textDecoration: 'none',
    borderRadius: '6px',
    background: active ? 'var(--bg-base)' : 'transparent',
    transition: 'all 0.15s ease',
    position: 'relative' as const,
  });

  const mobileLinkStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.6rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text-main)' : 'var(--text-muted)',
    textDecoration: 'none',
    borderRadius: '6px',
    background: active ? 'var(--bg-base)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  });

  return (
    <>
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.625rem 1.25rem',
        background: 'var(--panel-bg)',
        borderBottom: '1px solid var(--panel-border)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        {/* Left: Logo + Name */}
        <a href={isOwner ? '/overview' : '/dashboard'} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none', color: 'inherit' }}>
          <img
            src="/logos/logo.png"
            alt="RateTap"
            style={{ height: 32, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
          <div style={{ lineHeight: 1.2 }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.01em' }}>RateTap</p>
            <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{restaurantName}</p>
          </div>
        </a>

        {/* Center: Desktop nav links */}
        <div className="nav-links" style={{ alignItems: 'center' }}>
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a key={link.href} href={link.href} style={linkStyle(active)}>
                {link.label}
                {badgeCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    minWidth: 17,
                    height: 17,
                    borderRadius: 99,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
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
          className="btn btn-outline nav-links"
          style={{ fontSize: '0.75rem', padding: '0.35rem 1rem' }}
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
          <span style={{ width: 20, height: 2, background: 'var(--text-main)', borderRadius: 1, transition: 'all 0.2s', transform: mobileOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none' }} />
          <span style={{ width: 20, height: 2, background: 'var(--text-main)', borderRadius: 1, transition: 'all 0.2s', opacity: mobileOpen ? 0 : 1 }} />
          <span style={{ width: 20, height: 2, background: 'var(--text-main)', borderRadius: 1, transition: 'all 0.2s', transform: mobileOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none' }} />
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="nav-mobile-menu">
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a key={link.href} href={link.href} style={mobileLinkStyle(active)} onClick={() => setMobileOpen(false)}>
                {link.label}
                {badgeCount > 0 && (
                  <span style={{
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 99,
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
              marginTop: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.875rem',
              color: 'var(--red)',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              borderRadius: '6px',
            }}
          >
            {t.nav.signOut}
          </button>
        </div>
      )}
    </>
  );
}

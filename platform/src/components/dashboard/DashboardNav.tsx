'use client';

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

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue to login even if logout request fails
    }
    router.push('/login');
  }

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.5rem',
        background: 'var(--panel-bg)',
        color: 'var(--text-main)',
        borderBottom: '2px solid var(--border-dark)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        {/* RateTap logo */}
        <a href={isOwner ? '/overview' : '/dashboard'} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', color: 'inherit' }}>
          <img
            src="/logos/logo.png"
            alt="RateTap"
            style={{
              height: 36,
              width: 'auto',
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="editorial-serif" style={{ fontSize: '1.1rem', fontWeight: 600, letterSpacing: '-0.02em' }}>RateTap</span>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{restaurantName}</span>
          </div>
        </a>

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginLeft: '1rem',
            borderLeft: '1px solid var(--panel-border)',
            paddingLeft: '1.5rem',
          }}
        >
          {navLinks.map((link) => {
            const active = pathname === link.href;
            const badgeCount = 'badge' in link && link.badge ? (newFeedbackCount ?? 0) : 0;
            return (
              <a
                key={link.href}
                href={link.href}
                style={{
                  position: 'relative',
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.75rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text-main)' : 'var(--text-muted)',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: active ? 'var(--bg-base)' : 'transparent',
                  border: active ? '1px solid var(--border-dark)' : '1px solid transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-main)';
                    e.currentTarget.style.borderColor = 'var(--panel-border)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-muted)';
                    e.currentTarget.style.borderColor = 'transparent';
                  }
                }}
              >
                {link.label}
                {badgeCount > 0 && (
                  <span
                    className="font-numeric"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      background: 'var(--border-dark)',
                      color: 'var(--panel-bg)',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      minWidth: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
                      border: '1px solid var(--border-dark)',
                    }}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>
      <button
        onClick={handleLogout}
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-dark)',
          color: 'var(--text-main)',
          padding: '0.4rem 1.25rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
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
    </nav>
  );
}

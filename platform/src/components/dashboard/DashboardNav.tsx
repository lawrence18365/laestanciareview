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
        padding: '0.6rem 1.5rem',
        background: 'var(--espresso)',
        color: 'var(--warm-white)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Brand logo */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            overflow: 'hidden',
            background: logoDarkBg ? '#000' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <img
            src={logoSrc}
            alt={restaurantName}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              padding: 3,
            }}
          />
        </div>

        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 500,
            opacity: 0.9,
          }}
        >
          {restaurantName}
        </span>

        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            marginLeft: '0.5rem',
            borderLeft: '1px solid rgba(255,255,255,0.15)',
            paddingLeft: '1rem',
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
                  padding: '0.35rem 0.75rem',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  color: 'var(--warm-white)',
                  textDecoration: 'none',
                  background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                  opacity: active ? 1 : 0.7,
                  transition: 'background 0.15s, opacity 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.opacity = '0.7';
                }}
              >
                {link.label}
                {badgeCount > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      background: '#dc2626',
                      color: 'white',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 999,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 4px',
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
          background: 'none',
          border: '1px solid rgba(255,255,255,0.25)',
          color: 'var(--warm-white)',
          padding: '0.4rem 1rem',
          borderRadius: 6,
          fontSize: '0.85rem',
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        {t.nav.signOut}
      </button>
    </nav>
  );
}

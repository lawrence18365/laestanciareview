/**
 * US-14 T6b: solo-mode panel. Everything branches on isSolo(restaurant), i.e.
 * team_mode === 'solo'. NULL (every existing restaurant, incl. the 12 Grupo
 * Estancia locations) and 'team' must render exactly as before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const redirectMock = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
);
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));

import { navLinksFor } from '@/components/dashboard/DashboardNav';
import DashboardView from '@/components/dashboard/DashboardView';
import SettingsView from '@/components/dashboard/SettingsView';
import { HeroMetrics } from '@/app/(app)/guests/GuestsTable';
import { redirectIfSolo } from '@/app/(app)/solo-gate';
import { isSolo } from '@/lib/onboarding-profile';

const hrefs = (links: { href: string }[]) => links.map((l) => l.href);

describe('nav links per team_mode', () => {
  it('NULL / team keeps the full GM nav, including Personal, Invitados and Campañas', () => {
    const legacy = hrefs(navLinksFor({ isSolo: isSolo({ teamMode: null }) }));
    const team = hrefs(navLinksFor({ isSolo: isSolo({ teamMode: 'team' }) }));
    expect(legacy).toEqual([
      '/dashboard',
      '/live',
      '/inbox',
      '/guests',
      '/campaigns',
      '/staff',
      '/qr-codes',
      '/analytics',
      '/settings',
    ]);
    expect(team).toEqual(legacy);
  });

  it('solo drops Personal, Invitados and Campañas from the primary nav', () => {
    const solo = hrefs(navLinksFor({ isSolo: isSolo({ teamMode: 'solo' }) }));
    expect(solo).toEqual(['/dashboard', '/live', '/inbox', '/qr-codes', '/analytics', '/settings']);
    for (const gone of ['/guests', '/campaigns', '/staff']) {
      expect(solo).not.toContain(gone);
    }
  });

  it('events/quotes links and RateTap staff links still follow their own flags for solo', () => {
    const solo = hrefs(navLinksFor({ isSolo: true, showEventsQuotes: true, isStaff: true }));
    expect(solo).toContain('/leads');
    expect(solo).toContain('/quotes');
    expect(solo).toContain('/commercial-leads');
  });

  it('owner and regional navs are unaffected by the solo flag', () => {
    expect(hrefs(navLinksFor({ isOwner: true, isSolo: true }))).toEqual(
      hrefs(navLinksFor({ isOwner: true })),
    );
    expect(hrefs(navLinksFor({ isRegional: true, isSolo: true }))).toEqual(
      hrefs(navLinksFor({ isRegional: true })),
    );
  });
});

describe('solo redirect for /guests and /campaigns', () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it('redirects a solo restaurant to /dashboard', () => {
    expect(() => redirectIfSolo({ teamMode: 'solo' })).toThrow('NEXT_REDIRECT:/dashboard');
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });

  it('does nothing for NULL (legacy) or team restaurants', () => {
    redirectIfSolo({ teamMode: null });
    redirectIfSolo({ teamMode: 'team' });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('the guests, campaigns and campaign-detail pages all call the gate after loading the restaurant', () => {
    const root = join(__dirname, '..', 'app', '(app)');
    for (const file of ['guests/page.tsx', 'campaigns/page.tsx', 'campaigns/[id]/page.tsx']) {
      const src = readFileSync(join(root, file), 'utf8');
      const load = src.indexOf('getRestaurantBySlug(session.slug)');
      const gate = src.indexOf('redirectIfSolo(restaurant)');
      expect(load, file).toBeGreaterThan(-1);
      expect(gate, file).toBeGreaterThan(load);
    }
  });
});

const baseProps = {
  stats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
  lastWeekStats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
  leaderboard: [],
  unreadCount: 0,
  unreadLowCount: 0,
  roiStats: {
    totalReviews: 0,
    avgRating: 0,
    googleSends: 0,
    intercepted: 0,
    feedbackCount: 0,
    firstReviewAt: null,
  },
  monthlyStats: [],
  googleTrend: null,
  googleHistory: [],
  googleRating: null,
  googleReviewsToday: null,
};

describe('dashboard empty-state CTAs per team_mode', () => {
  it('NULL / team keeps "Agrega a tus meseros" and the QR codes CTA', () => {
    const html = renderToStaticMarkup(<DashboardView {...baseProps} googleReviewCount={12} />);
    expect(html).toContain('href="/staff"');
    expect(html).toContain('1. Agrega a tus meseros');
    expect(html).toContain('href="/qr-codes"');
    expect(html).toContain('2. Descarga sus códigos QR');
    expect(html).not.toContain('letrero');
    expect(html).not.toContain('Tienes ');
    // Passing isSolo={false} explicitly is the same as NULL.
    expect(renderToStaticMarkup(<DashboardView {...baseProps} googleReviewCount={12} isSolo={false} />)).toBe(html);
  });

  it('solo gets the letrero CTA, the WhatsApp share CTA and the Google count line', () => {
    const html = renderToStaticMarkup(
      <DashboardView
        {...baseProps}
        googleReviewCount={12}
        isSolo
        soloShareUrl="https://app.ratetapmx.com/r/tacos-ana"
      />,
    );
    expect(html).toContain('href="/qr-codes/letrero"');
    expect(html).toContain('1. Imprime tu letrero');
    expect(html).toContain('2. Compártelo por WhatsApp');
    expect(html).toContain(
      `href="https://wa.me/?text=${encodeURIComponent(
        '¿Cómo te fue? Déjanos tu reseña en Google: https://app.ratetapmx.com/r/tacos-ana',
      )}"`,
    );
    expect(html).toContain('Tienes 12 reseñas. Meta: 32.');
    expect(html).not.toContain('Agrega a tus meseros');
    expect(html).not.toContain('href="/staff"');
  });

  it('solo without a Google count shows no count line', () => {
    const html = renderToStaticMarkup(
      <DashboardView {...baseProps} googleReviewCount={null} isSolo soloShareUrl="https://x/r/a" />,
    );
    expect(html).toContain('1. Imprime tu letrero');
    expect(html).not.toContain('Tienes ');
  });

  it('solo with a count of 0 starts the goal at 20', () => {
    const html = renderToStaticMarkup(
      <DashboardView {...baseProps} googleReviewCount={0} isSolo soloShareUrl="https://x/r/a" />,
    );
    expect(html).toContain('Tienes 0 reseñas. Meta: 20.');
  });

  it('solo with reviews does not show the empty state at all', () => {
    const html = renderToStaticMarkup(
      <DashboardView
        {...baseProps}
        roiStats={{ ...baseProps.roiStats, totalReviews: 5, firstReviewAt: '2026-10-01T00:00:00Z' }}
        stats={{ totalReviews: 5, avgRating: 5, googleSends: 2 }}
        googleReviewCount={12}
        isSolo
      />,
    );
    expect(html).not.toContain('Imprime tu letrero');
  });
});

describe('settings labels per team_mode', () => {
  const settings = {
    name: 'Tacos Ana',
    slug: 'tacos-ana',
    googleReviewUrl: '',
    googlePlaceId: '',
    logoUrl: null,
    googleThreshold: 4,
    managerEmail: '',
    managerPhone: '',
    alertPreference: 'all',
    smsAlerts: false,
    whatsappAlerts: false,
  };
  const billing = {
    provider: 'mercadopago',
    status: 'trialing',
    mercadopagoStatus: null,
    nextPaymentDate: null,
    billingStartsAt: '2026-11-01T00:00:00.000Z',
    billingStarted: false,
    priceBreakdown: { base: 100, processingCharge: 5, total: 105 },
  } as never;

  it('NULL / team keeps the Gerente labels and shows no staff link', () => {
    const html = renderToStaticMarkup(<SettingsView settings={settings} billing={billing} />);
    expect(html).toContain('Email del Gerente');
    expect(html).toContain('Teléfono del Gerente');
    expect(html).not.toContain('Tu email');
    expect(html).not.toContain('Agrégalos aquí');
  });

  it('solo shows "Tu email" / "Tu teléfono" and the staff link in Settings', () => {
    const html = renderToStaticMarkup(<SettingsView settings={settings} billing={billing} isSolo />);
    expect(html).toContain('Tu email');
    expect(html).toContain('Tu teléfono');
    expect(html).not.toContain('del Gerente');
    expect(html).toContain('¿Contrataste meseros? Agrégalos aquí');
    expect(html).toContain('href="/staff"');
  });
});

describe('guests hero "Meseros" counter', () => {
  const metrics = {
    total: 10,
    validated: 3,
    activeStaff: 0,
    copaVino: 0,
    postre: 0,
    otro: 0,
    hoursInOperation: 5,
    leaderboard: [],
  };

  // activeStaff counts staff who validated a guest, which is 0 at most group
  // locations; solo restaurants never reach /guests, so the tile always renders.
  it('still renders at 0 (unchanged for group locations)', () => {
    const html = renderToStaticMarkup(<HeroMetrics metrics={metrics} justUpdated={false} />);
    expect(html).toContain('Meseros');
    expect(html).toContain('Invitados');
    expect(html).toContain('Cortesías');
  });

  it('is shown when staff exist', () => {
    const html = renderToStaticMarkup(
      <HeroMetrics metrics={{ ...metrics, activeStaff: 4 }} justUpdated={false} />,
    );
    expect(html).toContain('Meseros');
  });
});

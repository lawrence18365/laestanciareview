/**
 * Free-plan paywalls (inbox, Maps rank) and the first-rating card.
 * Counts stay visible, comment text never reaches the page, and Grupo
 * restaurants render exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  restaurant: {} as Record<string, unknown>,
  totalReviews: 0,
  googleSends: 0,
  feedbackCount: 0,
  getAllFeedback: vi.fn(),
  getMapsRankSummary: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'mi-cocina', role: 'gm', region: null })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => mocks.restaurant),
  getAllFeedback: mocks.getAllFeedback,
  getROIStats: vi.fn(async () => ({
    totalReviews: mocks.totalReviews,
    googleSends: mocks.googleSends,
    feedbackCount: mocks.feedbackCount,
    avgRating: 0,
    intercepted: 0,
    firstReviewAt: null,
  })),
  getFeedbackCounts: vi.fn(async () => ({ total: mocks.feedbackCount, unread: 0 })),
  getGroupKeyBySlug: vi.fn(async () => null),
  getWeeklyStats: vi.fn(async () => ({})),
  getLastWeekStats: vi.fn(async () => ({})),
  getLeaderboard: vi.fn(async () => []),
  restaurantHasStaff: vi.fn(async () => false),
  getNewFeedbackCount: vi.fn(async () => 0),
  getUnreadLowRatingCount: vi.fn(async () => 0),
  getMonthlyStats: vi.fn(async () => []),
}));
vi.mock('@/lib/complaint-sla', () => ({
  getComplaintSlaStats: vi.fn(async () => ({
    received: 0,
    reviewedWithin2h: 0,
    resolvedWithin24h: 0,
    overdueOpen: 0,
  })),
}));
vi.mock('@/lib/google-places', () => ({
  getGoogleRatingTrend: vi.fn(),
  getGoogleRatingHistory: vi.fn(),
  getGoogleReviewsAddedToday: vi.fn(),
}));
vi.mock('@/lib/maps-rank', () => ({ getMapsRankSummary: mocks.getMapsRankSummary }));
vi.mock('@/components/dashboard/FeedbackInbox', () => ({
  default: () => <div data-testid="feedback-inbox">COMMENT TEXT HERE</div>,
}));
vi.mock('@/components/dashboard/DashboardView', () => ({ default: () => <div>dashboard</div> }));

import InboxPage from '@/app/(app)/inbox/page';
import DashboardPage from '@/app/(app)/dashboard/page';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import FirstRatingCard from '@/components/dashboard/FirstRatingCard';
import { t } from '@/lib/i18n';

function setRestaurant(subscriptionStatus: string, groupKey: string | null) {
  mocks.restaurant = {
    id: 77,
    slug: 'mi-cocina',
    name: 'Mi Cocina',
    subscriptionStatus,
    groupKey,
    locationsBand: null,
    googleThreshold: 4,
    googlePlaceId: null,
    googleRating: null,
    googleReviewCount: null,
    region: null,
    teamMode: null,
  };
}

async function inboxHtml(): Promise<string> {
  const el = (await InboxPage({ searchParams: Promise.resolve({}) })) as ReactElement;
  return renderToStaticMarkup(el);
}

async function dashboardHtml(): Promise<string> {
  const el = (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement;
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  mocks.restaurant = {};
  mocks.totalReviews = 0;
  mocks.googleSends = 0;
  mocks.feedbackCount = 0;
  mocks.getAllFeedback.mockReset();
  mocks.getAllFeedback.mockResolvedValue([]);
  mocks.getMapsRankSummary.mockReset();
  mocks.getMapsRankSummary.mockResolvedValue([]);
  vi.stubEnv('MAPS_RANK_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('inbox paywall', () => {
  it('free: shows the count and a lock card, loads no comment rows', async () => {
    setRestaurant('canceled', null);
    mocks.feedbackCount = 7;
    const html = await inboxHtml();
    expect(html).toContain('7 comentarios de clientes');
    expect(html).toContain('Activa tu plan para leerlos.');
    expect(html).toContain('href="/plan"');
    expect(html).not.toContain('feedback-inbox');
    expect(html).not.toContain('COMMENT TEXT HERE');
    expect(mocks.getAllFeedback).not.toHaveBeenCalled();
  });

  it('free with one comment uses the singular', async () => {
    setRestaurant('expired', null);
    mocks.feedbackCount = 1;
    expect(await inboxHtml()).toContain('1 comentario de clientes');
  });

  it.each(['trialing', 'active'])('self-serve %s: shows the real inbox', async (status) => {
    setRestaurant(status, null);
    const html = await inboxHtml();
    expect(html).toContain('feedback-inbox');
    expect(html).not.toContain('/plan');
    expect(mocks.getAllFeedback).toHaveBeenCalledTimes(1);
  });

  it.each(['trialing', 'active'])('Grupo %s: shows the real inbox, no paywall', async (status) => {
    setRestaurant(status, 'grupo-estancia');
    const html = await inboxHtml();
    expect(html).toContain('feedback-inbox');
    expect(html).not.toContain('/plan');
    expect(mocks.getAllFeedback).toHaveBeenCalledTimes(1);
  });
});

describe('MapsRankCard teaser', () => {
  it('locked: shows the teaser with no rank data', () => {
    const html = renderToStaticMarkup(<MapsRankCard summaries={[]} locked />);
    expect(html).toContain(t.mapsRank.title);
    expect(html).toContain('Mira cómo apareces en Google Maps.');
    expect(html).toContain('href="/plan"');
  });

  it('locked: stays hidden when the Maps rank flag is off', () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    expect(renderToStaticMarkup(<MapsRankCard summaries={[]} locked />)).toBe('');
  });

  it('unlocked with no data: still renders nothing', () => {
    expect(renderToStaticMarkup(<MapsRankCard summaries={[]} />)).toBe('');
  });
});

describe('dashboard upgrade surfaces', () => {
  it('free: Maps rank is a locked teaser and no rank data is fetched', async () => {
    setRestaurant('canceled', null);
    const html = await dashboardHtml();
    expect(html).toContain('Mira cómo apareces en Google Maps.');
    expect(mocks.getMapsRankSummary).not.toHaveBeenCalled();
  });

  it('trial and paid: Maps rank data is fetched, no teaser', async () => {
    for (const status of ['trialing', 'active']) {
      mocks.getMapsRankSummary.mockClear();
      setRestaurant(status, null);
      const html = await dashboardHtml();
      expect(html).not.toContain('Mira cómo apareces');
      expect(mocks.getMapsRankSummary).toHaveBeenCalledTimes(1);
    }
  });

  it('Grupo: no teaser, rank data fetched as before', async () => {
    setRestaurant('active', 'grupo-estancia');
    mocks.totalReviews = 40;
    const html = await dashboardHtml();
    expect(html).not.toContain('Mira cómo apareces');
    expect(html).not.toContain('/plan');
    expect(mocks.getMapsRankSummary).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['trialing', null, 4, true],
    ['canceled', null, 4, true],
    ['trialing', null, 0, false],
    ['active', null, 4, false],
    ['trialing', 'grupo-estancia', 4, false],
    ['active', 'grupo-estancia', 4, false],
  ] as const)(
    'first-rating card: status %s group %s ratings %s -> shown %s',
    async (status, groupKey, ratings, shown) => {
      setRestaurant(status, groupKey);
      mocks.totalReviews = ratings;
      mocks.googleSends = 2;
      const el = (await DashboardPage({ searchParams: Promise.resolve({}) })) as ReactElement;
      const card = findByType(el, FirstRatingCard);
      expect(card !== null).toBe(shown);
      if (card) {
        expect(card.props).toMatchObject({
          slug: 'mi-cocina',
          plan: status === 'canceled' ? 'free' : 'trial',
          sentToGoogle: 2,
        });
      }
    },
  );
});

type AnyEl = ReactElement<{ children?: unknown }>;

function findByType(node: unknown, type: unknown): AnyEl | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findByType(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const el = node as AnyEl;
  if (el.type === type) return el;
  return findByType(el.props.children, type);
}

describe('first-rating card', () => {
  it('renders nothing on the server: it appears only after the client reads localStorage', () => {
    expect(
      renderToStaticMarkup(<FirstRatingCard slug="mi-cocina" plan="free" sentToGoogle={3} />),
    ).toBe('');
  });

  it('copy: plural, singular and no-send variants', () => {
    expect(t.upgrade.firstRating(3)).toBe('¡Tu primera calificación! 3 ya fueron a Google.');
    expect(t.upgrade.firstRating(1)).toBe('¡Tu primera calificación! 1 ya fue a Google.');
    expect(t.upgrade.firstRating(0)).toBe('¡Tu primera calificación!');
  });
});

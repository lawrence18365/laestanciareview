/**
 * (app)/layout.tsx subscription gate, driven by planFor().
 *
 * A Grupo restaurant that is not active/trialing is still blocked. A self-serve
 * restaurant with a lapsed trial enters the app on the free plan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const mocks = vi.hoisted(() => ({
  restaurant: {} as Record<string, unknown>,
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'mi-cocina', role: 'gm' })),
}));
vi.mock('@/lib/admin', () => ({ isRateTapStaff: vi.fn(() => false) }));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => mocks.restaurant),
  getNewFeedbackCount: vi.fn(async () => 0),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock('@/lib/brands', () => ({
  getBrandForRestaurant: vi.fn(() => ({ logo: '/logo.png', darkBg: false })),
  hasEventsQuotes: vi.fn(() => false),
}));
vi.mock('@/lib/group-device', () => ({ getKnownGroupKey: vi.fn(async () => null) }));
vi.mock('@/app/login/GroupDeviceMarker', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DashboardShell', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SubscriptionBlocked', () => ({ default: () => null }));

import AppLayout from '@/app/(app)/layout';
import SubscriptionBlocked from '@/components/dashboard/SubscriptionBlocked';

function setRestaurant(subscriptionStatus: string, groupKey: string | null) {
  mocks.restaurant = {
    id: 77,
    slug: 'mi-cocina',
    name: 'Mi Cocina',
    subscriptionStatus,
    groupKey,
    locationsBand: null,
    teamMode: null,
    billingProvider: 'mercadopago',
  };
}

async function render(): Promise<ReactElement> {
  return (await AppLayout({ children: null })) as ReactElement;
}

beforeEach(() => {
  mocks.restaurant = {};
});

describe('(app) layout subscription gate', () => {
  it.each(['canceled', 'past_due', 'paused'])(
    'still blocks a Grupo restaurant with status %s',
    async (status) => {
      setRestaurant(status, 'grupo-estancia');
      expect((await render()).type).toBe(SubscriptionBlocked);
    },
  );

  it.each(['active', 'trialing'])('lets a Grupo restaurant with status %s in', async (status) => {
    setRestaurant(status, 'grupo-estancia');
    expect((await render()).type).not.toBe(SubscriptionBlocked);
  });

  it.each(['canceled', 'expired', 'trialing', 'active'])(
    'lets a self-serve restaurant with status %s into the app',
    async (status) => {
      setRestaurant(status, null);
      expect((await render()).type).not.toBe(SubscriptionBlocked);
    },
  );
});

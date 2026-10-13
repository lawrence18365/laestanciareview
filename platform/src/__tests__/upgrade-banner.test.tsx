/**
 * App-shell upgrade banner: trial countdown (only in the last 10 days), free
 * plan banner, nothing for paid, and no banner at all for Grupo restaurants.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import DashboardShell from '@/components/dashboard/DashboardShell';
import UpgradeBanner from '@/components/dashboard/UpgradeBanner';
import { upgradeStateFor, type UpgradeState } from '@/components/dashboard/upgrade-state';

const DAY = 24 * 60 * 60 * 1000;

function setRestaurant(
  subscriptionStatus: string,
  groupKey: string | null,
  trialDays: number | null = null,
) {
  mocks.restaurant = {
    id: 77,
    slug: 'mi-cocina',
    name: 'Mi Cocina',
    subscriptionStatus,
    groupKey,
    locationsBand: null,
    teamMode: null,
    billingProvider: 'mercadopago',
    // Half a day into the last day, so the rounded-up count is exactly trialDays.
    trialEndsAt: trialDays === null ? null : new Date(Date.now() + (trialDays - 1) * DAY + 12 * 60 * 60 * 1000),
  };
}

/** The upgrade prop the layout hands to the shell. */
async function upgradeProp(): Promise<UpgradeState | null | undefined> {
  const root = (await AppLayout({ children: null })) as ReactElement<{ children: unknown }>;
  const kids = ([] as unknown[]).concat(root.props.children);
  const shell = kids.find(
    (k): k is ReactElement<{ upgrade?: UpgradeState | null }> =>
      !!k && typeof k === 'object' && (k as ReactElement).type === DashboardShell,
  );
  expect(shell).toBeDefined();
  return shell!.props.upgrade;
}

function html(upgrade: UpgradeState | null | undefined): string {
  return renderToStaticMarkup(<UpgradeBanner upgrade={upgrade} />);
}

beforeEach(() => {
  mocks.restaurant = {};
});

describe('upgrade banner per plan (self-serve)', () => {
  it('shows nothing at 11 days left in the trial', async () => {
    setRestaurant('trialing', null, 11);
    const upgrade = await upgradeProp();
    expect(upgrade ?? null).toBeNull();
    expect(html(upgrade)).toBe('');
  });

  it('shows the countdown at 5 days left', async () => {
    setRestaurant('trialing', null, 5);
    const upgrade = await upgradeProp();
    expect(upgrade).toEqual({ kind: 'trial', daysLeft: 5 });
    const markup = html(upgrade);
    expect(markup).toContain('Tu prueba termina en 5 días · Ver planes');
    expect(markup).toContain('href="/plan"');
  });

  it('shows the countdown at exactly 10 days left', async () => {
    setRestaurant('trialing', null, 10);
    expect(await upgradeProp()).toEqual({ kind: 'trial', daysLeft: 10 });
  });

  it('uses the singular at 1 day and "hoy" at the last day', () => {
    expect(html({ kind: 'trial', daysLeft: 1 })).toContain('Tu prueba termina en 1 día · Ver planes');
    expect(html({ kind: 'trial', daysLeft: 0 })).toContain('Tu prueba termina hoy · Ver planes');
  });

  it('shows nothing when the trial end date is unknown', async () => {
    setRestaurant('trialing', null, null);
    expect((await upgradeProp()) ?? null).toBeNull();
  });

  it.each(['canceled', 'expired', 'past_due'])(
    'shows the free plan banner for status %s',
    async (status) => {
      setRestaurant(status, null);
      const upgrade = await upgradeProp();
      expect(upgrade).toEqual({ kind: 'free' });
      const markup = html(upgrade);
      expect(markup).toContain(
        'Plan gratis: tu QR sigue funcionando. Activa tu plan para ver comentarios y alertas.',
      );
      expect(markup).toContain('href="/plan"');
    },
  );

  it('shows nothing for a paid restaurant', async () => {
    setRestaurant('active', null);
    const upgrade = await upgradeProp();
    expect(upgrade ?? null).toBeNull();
    expect(html(upgrade)).toBe('');
  });
});

describe('upgrade banner for Grupo restaurants', () => {
  it.each([
    ['trialing', 5],
    ['trialing', 11],
    ['active', null],
  ] as const)('is absent for a Grupo restaurant with status %s (%s days)', async (status, days) => {
    setRestaurant(status, 'grupo-estancia', days);
    const upgrade = await upgradeProp();
    expect(upgrade ?? null).toBeNull();
    expect(html(upgrade)).toBe('');
  });

  it('renders identically to a restaurant with no trial data at all', () => {
    const near = upgradeStateFor({
      subscriptionStatus: 'trialing',
      groupKey: 'grupo-estancia',
      trialEndsAt: new Date(Date.now() + DAY),
    });
    const none = upgradeStateFor({
      subscriptionStatus: 'active',
      groupKey: 'grupo-estancia',
      trialEndsAt: null,
    });
    expect(near).toBeNull();
    expect(none).toBeNull();
    expect(html(near)).toBe(html(none));
  });
});

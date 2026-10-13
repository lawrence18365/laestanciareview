/**
 * /plan page: self-serve only, prices from env, honest billing copy, and the
 * word budgets for every upgrade surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ restaurant: {} as Record<string, unknown> }));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'mi-cocina', role: 'gm' })),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => mocks.restaurant),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

import PlanPage from '@/app/(app)/plan/page';
import { formatMx, monthsFree } from '@/components/dashboard/PlanChooser';
import UpgradeBanner from '@/components/dashboard/UpgradeBanner';
import LockedFeedbackCard from '@/components/dashboard/LockedFeedbackCard';
import MapsRankCard from '@/components/dashboard/MapsRankCard';
import { t } from '@/lib/i18n';

function setRestaurant(
  subscriptionStatus: string,
  groupKey: string | null,
  locationsBand: string | null = null,
) {
  mocks.restaurant = { id: 77, slug: 'mi-cocina', subscriptionStatus, groupKey, locationsBand };
}

async function planHtml(): Promise<string> {
  return renderToStaticMarkup((await PlanPage()) as ReactElement);
}

/** Visible words: strip tags, collapse whitespace. */
function words(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  return text.split(/\s+/).filter(Boolean).length;
}

beforeEach(() => {
  mocks.restaurant = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/plan page', () => {
  it('shows the default Plan Restaurante prices', async () => {
    setRestaurant('trialing', null);
    const html = await planHtml();
    expect(html).toContain('MX$299');
    expect(html).toContain('MX$2,490');
    expect(html).toContain('MX$208/mes');
  });

  it('reads prices from env, nothing is hardcoded', async () => {
    vi.stubEnv('SELF_SERVE_MONTHLY_MXN', '349');
    vi.stubEnv('SELF_SERVE_ANNUAL_MXN', '3000');
    setRestaurant('canceled', null);
    const html = await planHtml();
    expect(html).toContain('MX$349');
    expect(html).toContain('MX$3,000');
    expect(html).toContain('MX$250/mes');
    expect(html).not.toContain('MX$299');
    expect(html).not.toContain('MX$2,490');
  });

  it('states the cycle, cancel-anytime and annual renewal', async () => {
    setRestaurant('trialing', null);
    const html = await planHtml();
    expect(html).toContain('Cancela cuando quieras. El plan anual se renueva cada año.');
    expect(html).toContain('Tu QR siempre funciona, incluso en el plan gratis.');
    expect(html).toContain('/mes');
    expect(html).toContain('/año');
  });

  it('lists at most six included items and preselects the annual card', async () => {
    setRestaurant('trialing', null);
    const html = await planHtml();
    expect(t.upgrade.plan.included.length).toBeLessThanOrEqual(6);
    for (const item of t.upgrade.plan.included) expect(html).toContain(item);
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="annual"/);
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="monthly"/);
  });

  it('has exactly one CTA button, and no pre-checked consent box', async () => {
    setRestaurant('trialing', null);
    const html = await planHtml();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('type="checkbox"');
  });

  it.each(['trialing', 'active', 'canceled'])(
    'sends a Grupo restaurant (%s) to /settings',
    async (status) => {
      setRestaurant(status, 'grupo-estancia');
      await expect(PlanPage()).rejects.toThrow('redirect:/settings');
    },
  );

  it('sends a paying self-serve restaurant to /settings', async () => {
    setRestaurant('active', null);
    await expect(PlanPage()).rejects.toThrow('redirect:/settings');
  });

  it('sends a multi-location self-serve restaurant to /settings (different price path)', async () => {
    setRestaurant('trialing', null, '2-5');
    await expect(PlanPage()).rejects.toThrow('redirect:/settings');
  });
});

describe('plan helpers', () => {
  it('formats pesos', () => {
    expect(formatMx(2490)).toBe('MX$2,490');
    expect(formatMx(299)).toBe('MX$299');
  });

  it('counts whole months the annual plan saves', () => {
    expect(monthsFree(299, 2490)).toBe(3);
    expect(monthsFree(299, 3588)).toBe(0);
    expect(monthsFree(299, 4000)).toBe(0);
  });
});

describe('word budgets', () => {
  it('/plan page stays under the 450-word pricing budget', async () => {
    setRestaurant('trialing', null);
    expect(words(await planHtml())).toBeLessThanOrEqual(450);
  });

  it('upgrade asks stay at 20 words or fewer', () => {
    const asks: string[] = [
      t.upgrade.trialBanner(5),
      t.upgrade.freeBanner,
      t.upgrade.firstRating(12),
      `${t.upgrade.lockedFeedbackTitle(12)} ${t.upgrade.lockedFeedbackBody}`,
      t.upgrade.lockedMapsBody,
    ];
    for (const ask of asks) expect(ask.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('rendered banner, lock card and teaser stay at 20 visible words or fewer', () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    const surfaces = [
      renderToStaticMarkup(<UpgradeBanner upgrade={{ kind: 'trial', daysLeft: 5 }} />),
      renderToStaticMarkup(<UpgradeBanner upgrade={{ kind: 'free' }} />),
      renderToStaticMarkup(<LockedFeedbackCard count={12} />),
      renderToStaticMarkup(<MapsRankCard summaries={[]} locked />),
    ];
    for (const s of surfaces) expect(words(s)).toBeLessThanOrEqual(20);
  });
});

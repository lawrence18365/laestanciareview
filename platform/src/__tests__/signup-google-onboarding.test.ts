/**
 * Provisioning stores the Google numbers + profile and one baseline snapshot
 * when the fetch succeeds, and still completes with NULLs when it fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as { table: unknown; values: Record<string, unknown> }[],
  fetchGoogle: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'mi-pizza'),
  slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}));
vi.mock('@/lib/google-onboarding', () => ({ fetchOnboardingGoogleData: mocks.fetchGoogle }));

vi.mock('@/db', () => {
  function insertBuilder(table: unknown) {
    return {
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.inserted.push({ table, values });
        return { returning: vi.fn(async () => [{ id: 77, slug: 'mi-pizza' }]) };
      }),
    };
  }
  function selectBuilder() {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'where', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return builder;
  }
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(selectBuilder),
    insert: vi.fn(insertBuilder),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };
  return {
    db: { insert: vi.fn(insertBuilder) },
    transactionDb: {
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { googleRatingSnapshots, restaurants } from '@/db/schema';
import { provisionSignupAtomic, provisionSignupRestaurant } from '@/lib/signup-provisioning';

const base = {
  businessName: 'Mi Pizza',
  email: 'owner@example.com',
  passwordHash: 'hash',
  trialEndsAt: new Date('2026-11-12T00:00:00.000Z'),
};

const profile = {
  primaryType: 'pizza_restaurant',
  types: ['pizza_restaurant'],
  takeout: true,
  delivery: true,
  dineIn: false,
  lat: 21.12,
  lng: -101.68,
  formattedAddress: 'León',
  competitors: [{ name: 'B', reviewCount: 310, rating: 4.5, distanceM: 400 }],
  fetchedAt: '2026-10-13T12:00:00.000Z',
};

const rows = (table: unknown) => mocks.inserted.filter((i) => i.table === table).map((i) => i.values);

describe('provisioning stores Google onboarding data', () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.fetchGoogle.mockReset();
  });

  it.each([
    ['provisionSignupRestaurant', () => provisionSignupRestaurant({ ...base, googlePlaceId: 'ChIJabc' })],
    ['provisionSignupAtomic', () => provisionSignupAtomic({ ...base, googlePlaceId: 'ChIJabc', pendingSignupId: 'p1', leadId: 1 })],
  ])('%s persists rating, count, profile and one baseline snapshot', async (_name, run) => {
    mocks.fetchGoogle.mockResolvedValue({ rating: '4.6', reviewCount: 87, profile });
    await run();

    expect(mocks.fetchGoogle).toHaveBeenCalledWith('ChIJabc');
    expect(rows(restaurants)[0]).toMatchObject({
      googleRating: '4.6',
      googleReviewCount: 87,
      googleProfile: profile,
    });
    expect(rows(restaurants)[0].googleRatingUpdatedAt).toBeInstanceOf(Date);
    expect(rows(googleRatingSnapshots)).toEqual([{ restaurantId: 77, rating: '4.6', reviewCount: 87 }]);
  });

  it.each([
    ['provisionSignupRestaurant', () => provisionSignupRestaurant({ ...base, googlePlaceId: 'ChIJabc' })],
    ['provisionSignupAtomic', () => provisionSignupAtomic({ ...base, googlePlaceId: 'ChIJabc', pendingSignupId: 'p2', leadId: 2 })],
  ])('%s still completes when the fetch fails (nulls, no snapshot)', async (_name, run) => {
    mocks.fetchGoogle.mockResolvedValue({ rating: null, reviewCount: null, profile: null });
    await expect(run()).resolves.toMatchObject({ id: 77 });

    expect(rows(restaurants)).toHaveLength(1);
    expect(rows(restaurants)[0]).not.toHaveProperty('googleProfile');
    expect(rows(restaurants)[0]).not.toHaveProperty('googleRating');
    expect(rows(googleRatingSnapshots)).toHaveLength(0);
  });

  it('writes no snapshot when the place has a profile but no rating yet', async () => {
    mocks.fetchGoogle.mockResolvedValue({ rating: null, reviewCount: null, profile });
    await provisionSignupRestaurant({ ...base, googlePlaceId: 'ChIJabc' });
    expect(rows(restaurants)[0]).toMatchObject({ googleRating: null, googleProfile: profile, googleRatingUpdatedAt: null });
    expect(rows(googleRatingSnapshots)).toHaveLength(0);
  });

  it('does not call Google without a place ID (legacy signup unchanged)', async () => {
    await provisionSignupRestaurant(base);
    await provisionSignupAtomic({ ...base, pendingSignupId: 'p3', leadId: 3 });
    expect(mocks.fetchGoogle).not.toHaveBeenCalled();
    expect(rows(googleRatingSnapshots)).toHaveLength(0);
    for (const row of rows(restaurants)) expect(row).not.toHaveProperty('googleProfile');
  });
});

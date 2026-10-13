/**
 * Signup stores a self-serve restaurant's one category+city Maps rank keyword
 * and runs a one-time sweep for it, in the background (SQ-210).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as unknown[],
  sweep: vi.fn(),
}));

vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'pizzeria-lupita'),
  slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('@/lib/chain-detect', () => ({ detectChain: vi.fn(async () => null) }));

vi.mock('@/lib/google-onboarding', () => ({
  fetchOnboardingGoogleData: vi.fn(async () => ({
    rating: 4.5,
    reviewCount: 20,
    profile: {
      primaryType: 'pizza_restaurant',
      types: [],
      takeout: null,
      delivery: null,
      dineIn: null,
      lat: null,
      lng: null,
      formattedAddress: null,
      competitors: [],
      fetchedAt: '2026-10-13T00:00:00.000Z',
    },
  })),
}));

vi.mock('@/lib/maps-rank', () => ({
  runMapsRankSweep: mocks.sweep,
}));

vi.mock('@/db', () => {
  function insertBuilder() {
    return {
      values: vi.fn((values: unknown) => {
        mocks.inserted.push(values);
        return {
          returning: vi.fn(async () => [{ id: 77, slug: 'pizzeria-lupita' }]),
          onConflictDoNothing: vi.fn(async () => undefined),
        };
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
    db: { insert: vi.fn(insertBuilder), update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })) },
    transactionDb: {
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { provisionSignupAtomic, setupSelfServeMapsRank } from '@/lib/signup-provisioning';

const input = {
  businessName: 'Pizzería Lupita',
  email: 'lupita@example.com',
  passwordHash: 'hash',
  city: 'Los Mochis',
  googlePlaceId: 'place-lupita',
  trialEndsAt: new Date('2026-11-12T00:00:00.000Z'),
  pendingSignupId: 'pending-1',
  leadId: 1,
};

function keywordInserts() {
  return mocks.inserted.filter(
    (v): v is Array<{ restaurantId: number; keyword: string }> =>
      Array.isArray(v) && typeof (v[0] as { keyword?: unknown })?.keyword === 'string',
  );
}

describe('signup Maps rank one-off', () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.sweep.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stores the keyword and forces a one-restaurant sweep without blocking signup', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    // A sweep that never finishes: signup must still return.
    mocks.sweep.mockReturnValue(new Promise(() => {}));

    const restaurant = await provisionSignupAtomic(input);

    expect(restaurant).toEqual({ id: 77, slug: 'pizzeria-lupita' });
    await vi.waitFor(() => expect(mocks.sweep).toHaveBeenCalledTimes(1));
    expect(mocks.sweep).toHaveBeenCalledWith({ restaurantId: 77, force: true });
    expect(keywordInserts()).toEqual([[{ restaurantId: 77, keyword: 'pizzería Los Mochis' }]]);
  });

  it('does nothing when MAPS_RANK_ENABLED is off', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    await provisionSignupAtomic(input);
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.sweep).not.toHaveBeenCalled();
    expect(keywordInserts()).toEqual([]);
  });

  it('does nothing without a Google place or a city', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    await setupSelfServeMapsRank({ id: 5, city: 'León', googlePlaceId: null });
    await setupSelfServeMapsRank({ id: 5, city: null, googlePlaceId: 'p' });
    expect(mocks.sweep).not.toHaveBeenCalled();
    expect(keywordInserts()).toEqual([]);
  });

  it('never throws when the sweep fails', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    mocks.sweep.mockRejectedValue(new Error('places down'));
    await expect(
      setupSelfServeMapsRank({ id: 5, city: 'León', googlePlaceId: 'p' }),
    ).resolves.toBeUndefined();
  });
});

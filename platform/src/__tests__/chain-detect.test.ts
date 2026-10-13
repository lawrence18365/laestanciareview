/**
 * Chain detection at signup (US-15 M5): name normalization, the 3+ threshold,
 * failures that never break signup, and group restaurants never processed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectChain: vi.fn(),
  sendChainSignupAlert: vi.fn(async () => undefined),
  fetchGoogle: vi.fn(async () => ({ rating: null, reviewCount: null, profile: null })),
  updates: [] as Record<string, unknown>[],
  updateFails: false,
}));

vi.mock('@/lib/email', () => ({ sendChainSignupAlert: mocks.sendChainSignupAlert }));
vi.mock('@/lib/google-onboarding', () => ({ fetchOnboardingGoogleData: mocks.fetchGoogle }));
vi.mock('@/lib/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'mi-pizza'),
  slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}));
vi.mock('@/lib/chain-detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chain-detect')>();
  return { ...actual, detectChain: mocks.detectChain };
});
vi.mock('@/db', () => {
  const insertBuilder = () => ({
    values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 77, slug: 'mi-pizza' }]) })),
  });
  const selectBuilder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit']) b[m] = vi.fn(() => b);
    b.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return b;
  };
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(selectBuilder),
    insert: vi.fn(insertBuilder),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  };
  return {
    db: {
      insert: vi.fn(insertBuilder),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          mocks.updates.push(values);
          return {
            where: vi.fn(async () => {
              if (mocks.updateFails) throw new Error('db down');
            }),
          };
        }),
      })),
    },
    transactionDb: { transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
  };
});

import { normalizeBrandName } from '@/lib/chain-detect';
import { parseGoogleProfile } from '@/lib/onboarding-profile';
import {
  CHAIN_ALERT_THRESHOLD,
  provisionSignupAtomic,
  provisionSignupRestaurant,
  recordChainDetection,
} from '@/lib/signup-provisioning';

// The unmocked module, loaded once so the timer in detectChain starts synchronously.
let actualModule: typeof import('@/lib/chain-detect');
beforeAll(async () => {
  actualModule = await vi.importActual<typeof import('@/lib/chain-detect')>('@/lib/chain-detect');
});
const actualDetect = (name: string, placeId = '') => actualModule.detectChain(name, placeId);

function places(...items: [string, string, string?][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      places: items.map(([id, text, formattedAddress]) => ({
        id,
        displayName: { text },
        formattedAddress,
      })),
    }),
  };
}

describe('normalizeBrandName', () => {
  it.each([
    ['Tacos El Güero', 'tacos el guero'],
    ['  CAFÉ   Ñandú ', 'cafe nandu'],
    ['Tacos El Güero - Centro', 'tacos el guero'],
    ['Tacos El Güero – Centro', 'tacos el guero'],
    ['Tacos El Güero -Centro', 'tacos el guero'],
    ['Tacos El Güero Sucursal Norte', 'tacos el guero'],
    ['Tacos El Güero sucursal', 'tacos el guero'],
    ['Coca-Cola Café', 'cocacola cafe'],
    ["Domino's Pizza", 'dominos pizza'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeBrandName(raw)).toBe(expected);
  });
});

describe('detectChain', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('sends the Places v1 text search for Mexico and counts distinct same-brand places', async () => {
    const fetchMock = vi.fn(async () =>
      places(
        ['p1', 'Tacos El Güero', 'Calle 1'],
        ['p2', 'TACOS EL GUERO - Centro', 'Calle 2'],
        ['p3', 'Tacos el Güero Sucursal Norte', 'Calle 3'],
        ['p3', 'Tacos el Güero Sucursal Norte', 'Calle 3'], // duplicate id
        ['p4', 'Tacos El Güeroncito', 'Calle 4'], // different brand, shares a prefix
        ['p5', 'La Taquería', 'Calle 5'], // unrelated
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await actualDetect('Tacos El Güero', 'p1');

    expect(result).toEqual({
      count: 3,
      samplePlaceIds: ['p1', 'p2', 'p3'],
      sampleAddresses: ['Calle 1', 'Calle 2', 'Calle 3'],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.formattedAddress');
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      textQuery: 'Tacos El Güero',
      pageSize: 20,
      languageCode: 'es',
      regionCode: 'MX',
    });
  });

  it('counts the signup place even when the search did not return it', async () => {
    globalThis.fetch = vi.fn(async () =>
      places(['p2', 'Mi Pizza', 'A'], ['p3', 'Mi Pizza', 'B']),
    ) as unknown as typeof fetch;
    const result = await actualDetect('Mi Pizza', 'own');
    expect(result?.count).toBe(3);
    expect(result?.samplePlaceIds).toContain('own');
  });

  it('returns a single-location count of 1 for a unique name', async () => {
    globalThis.fetch = vi.fn(async () => places(['p1', 'Mi Pizza'])) as unknown as typeof fetch;
    expect((await actualDetect('Mi Pizza', 'p1'))?.count).toBe(1);
  });

  it('returns null (never throws) when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    await expect(actualDetect('Mi Pizza', 'p1')).resolves.toBeNull();
  });

  it('returns null on an HTTP error, a malformed payload, a missing key and an empty name', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(actualDetect('Mi Pizza', 'p1')).resolves.toBeNull();

    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ places: 'x' }) })) as unknown as typeof fetch;
    await expect(actualDetect('Mi Pizza', 'p1')).resolves.toBeNull();

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    })) as unknown as typeof fetch;
    await expect(actualDetect('Mi Pizza', 'p1')).resolves.toBeNull();

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(actualDetect('   ', 'p1')).resolves.toBeNull();
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(actualDetect('Mi Pizza', 'p1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts after the 3s budget and returns null', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const pending = actualDetect('Mi Pizza', 'p1');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('google_profile tolerates chainCount', () => {
  const base = { fetchedAt: '2026-10-13T12:00:00.000Z' };
  it('keeps a numeric chainCount and ignores junk', () => {
    expect(parseGoogleProfile({ ...base, chainCount: 4 })?.chainCount).toBe(4);
    expect(parseGoogleProfile({ ...base, chainCount: 'x' })).not.toHaveProperty('chainCount');
    expect(parseGoogleProfile(base)).not.toHaveProperty('chainCount');
  });
  it('a chainCount-only blob (no Places profile) parses to null, not a crash', () => {
    expect(parseGoogleProfile({ chainCount: 3 })).toBeNull();
  });
});

describe('recordChainDetection', () => {
  const restaurant = {
    id: 77,
    slug: 'mi-pizza',
    name: 'Mi Pizza',
    groupKey: null,
    googlePlaceId: 'p1',
    city: 'León',
    contactName: 'Ana',
    email: 'ana@example.com',
    phone: '4771234567',
  };

  beforeEach(() => {
    mocks.detectChain.mockReset();
    mocks.sendChainSignupAlert.mockClear();
    mocks.updates.length = 0;
    mocks.updateFails = false;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('stores chainCount and alerts at exactly the threshold', async () => {
    mocks.detectChain.mockResolvedValue({
      count: CHAIN_ALERT_THRESHOLD,
      samplePlaceIds: ['a', 'b', 'c'],
      sampleAddresses: ['A1', 'A2', 'A3'],
    });
    await expect(recordChainDetection(restaurant)).resolves.toBe(3);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.sendChainSignupAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendChainSignupAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantName: 'Mi Pizza',
        count: 3,
        city: 'León',
        contactName: 'Ana',
        email: 'ana@example.com',
        slug: 'mi-pizza',
        addresses: ['A1', 'A2', 'A3'],
      }),
    );
  });

  it.each([1, 2])('stores the count but does not alert at %i location(s)', async (count) => {
    mocks.detectChain.mockResolvedValue({ count, samplePlaceIds: [], sampleAddresses: [] });
    await expect(recordChainDetection(restaurant)).resolves.toBe(count);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.sendChainSignupAlert).not.toHaveBeenCalled();
  });

  it('does nothing when detection fails (null)', async () => {
    mocks.detectChain.mockResolvedValue(null);
    await expect(recordChainDetection(restaurant)).resolves.toBeNull();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.sendChainSignupAlert).not.toHaveBeenCalled();
  });

  it('never throws when detection or the db write blows up', async () => {
    mocks.detectChain.mockRejectedValue(new Error('boom'));
    await expect(recordChainDetection(restaurant)).resolves.toBeNull();

    mocks.detectChain.mockResolvedValue({ count: 5, samplePlaceIds: [], sampleAddresses: [] });
    mocks.updateFails = true;
    await expect(recordChainDetection(restaurant)).resolves.toBeNull();
  });

  it('never processes a group restaurant', async () => {
    mocks.detectChain.mockResolvedValue({ count: 9, samplePlaceIds: [], sampleAddresses: [] });
    await expect(recordChainDetection({ ...restaurant, groupKey: 'estancia' })).resolves.toBeNull();
    expect(mocks.detectChain).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.sendChainSignupAlert).not.toHaveBeenCalled();
  });
});

describe('signup still completes when chain detection fails', () => {
  const input = {
    businessName: 'Mi Pizza',
    email: 'owner@example.com',
    passwordHash: 'hash',
    googlePlaceId: 'p1',
    trialEndsAt: new Date('2026-11-12T00:00:00.000Z'),
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    mocks.detectChain.mockReset();
    mocks.sendChainSignupAlert.mockClear();
    mocks.updates.length = 0;
    mocks.updateFails = false;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['null', () => mocks.detectChain.mockResolvedValue(null)],
    ['a rejection', () => mocks.detectChain.mockRejectedValue(new Error('boom'))],
  ])('provisionSignupAtomic resolves on %s', async (_label, arrange) => {
    arrange();
    await expect(
      provisionSignupAtomic({ ...input, pendingSignupId: 'ps-1', leadId: 1 }),
    ).resolves.toEqual({ id: 77, slug: 'mi-pizza' });
    await flush();
    expect(mocks.sendChainSignupAlert).not.toHaveBeenCalled();
  });

  it('provisionSignupRestaurant resolves on a detection failure', async () => {
    mocks.detectChain.mockRejectedValue(new Error('boom'));
    await expect(provisionSignupRestaurant(input)).resolves.toEqual({ id: 77, slug: 'mi-pizza' });
    await flush();
  });

  it('a new self-serve signup at 4 locations stores chainCount and alerts the founders once', async () => {
    mocks.detectChain.mockResolvedValue({ count: 4, samplePlaceIds: [], sampleAddresses: ['X'] });
    await provisionSignupAtomic({
      ...input,
      city: 'León',
      contactName: 'Ana',
      pendingSignupId: 'ps-2',
      leadId: 2,
    });
    await flush();
    expect(mocks.detectChain).toHaveBeenCalledWith('Mi Pizza', 'p1');
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.sendChainSignupAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendChainSignupAlert).toHaveBeenCalledWith(
      expect.objectContaining({ count: 4, restaurantName: 'Mi Pizza', city: 'León' }),
    );
  });

  it('a single-location signup is stored but not alerted', async () => {
    mocks.detectChain.mockResolvedValue({ count: 1, samplePlaceIds: [], sampleAddresses: [] });
    await provisionSignupRestaurant(input);
    await flush();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.sendChainSignupAlert).not.toHaveBeenCalled();
  });
});

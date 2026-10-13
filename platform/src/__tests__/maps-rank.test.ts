import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  joinRows: [] as Array<{
    id: number;
    placeId: string | null;
    keyword: string;
    groupKey?: string | null;
    subscriptionStatus?: string;
    locationsBand?: string | null;
  }>,
  wheres: [] as unknown[],
  inserts: [] as Array<Array<{ restaurantId: number; keyword: string; gridPoint: number; status: string; rank: number | null }>>,
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async (w: unknown) => {
            state.wheres.push(w);
            return state.joinRows;
          },
        }),
      }),
    }),
    insert: () => ({
      values: (rows: never[]) => ({
        onConflictDoUpdate: async () => {
          state.inserts.push(rows);
        },
      }),
    }),
  },
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import { gridPoints, runMapsRankSweep, searchRank, summarizeSamples, isSweepDay } from '@/lib/maps-rank';
import { defaultKeywords } from '@/lib/maps-rank-keywords';

const SUNDAY_NOON_MX = new Date('2026-10-11T18:00:00Z');
const MONDAY_NOON_MX = new Date('2026-10-12T18:00:00Z');
const CENTER = { lat: 20.6736, lng: -101.3563 };

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe('gridPoints', () => {
  it('returns 9 points with the center at index 4', () => {
    const points = gridPoints(CENTER);
    expect(points).toHaveLength(9);
    expect(points[4]).toEqual(CENTER);
  });

  it('spaces neighbours about 1500 m apart, within 2%', () => {
    const points = gridPoints(CENTER);
    const east = haversineMeters(points[4], points[5]);
    const north = haversineMeters(points[4], points[1]);
    expect(Math.abs(east - 1500) / 1500).toBeLessThan(0.02);
    expect(Math.abs(north - 1500) / 1500).toBeLessThan(0.02);
  });

  it('orders rows north to south, columns west to east', () => {
    const points = gridPoints(CENTER);
    expect(points[0].lat).toBeGreaterThan(points[3].lat);
    expect(points[0].lng).toBeLessThan(points[2].lng);
  });
});

describe('searchRank', () => {
  const point = CENTER;
  const placeId = 'place-ours';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
  });

  function stubSearch(response: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns found with the 1-based index of our place', async () => {
    stubSearch(() =>
      Response.json({ places: [{ id: 'other-1' }, { id: 'other-2' }, { id: placeId }] }),
    );
    await expect(searchRank('restaurante leon', point, placeId)).resolves.toEqual({
      status: 'found',
      rank: 3,
    });
  });

  it('returns not_returned when our place is absent', async () => {
    stubSearch(() => Response.json({ places: [{ id: 'other-1' }] }));
    await expect(searchRank('restaurante leon', point, placeId)).resolves.toEqual({
      status: 'not_returned',
    });
  });

  it('returns error on a non-200 response', async () => {
    stubSearch(() => new Response('nope', { status: 500 }));
    await expect(searchRank('restaurante leon', point, placeId)).resolves.toEqual({ status: 'error' });
  });

  it('returns error when fetch throws', async () => {
    stubSearch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(searchRank('restaurante leon', point, placeId)).resolves.toEqual({ status: 'error' });
  });

  it('sends the key in a header with field mask exactly places.id', async () => {
    const fetchMock = stubSearch(() => Response.json({ places: [] }));
    await searchRank('restaurante leon', point, placeId);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('places.id');
    expect(JSON.parse(init.body as string).rankPreference).toBe('RELEVANCE');
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(url).not.toContain('test-key');
  });

  it('strips quotes and a literal trailing backslash-n from the key', async () => {
    const prev = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = '"test-key\\n"';
    try {
      const fetchMock = stubSearch(() => Response.json({ places: [] }));
      await searchRank('restaurante leon', point, placeId);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
    } finally {
      process.env.GOOGLE_PLACES_API_KEY = prev;
    }
  });
});

describe('runMapsRankSweep', () => {
  beforeEach(() => {
    state.inserts.length = 0;
    state.joinRows = [];
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('skips when MAPS_RANK_ENABLED is not true', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    await expect(runMapsRankSweep({ now: SUNDAY_NOON_MX })).resolves.toMatchObject({
      skipped: 'disabled',
    });
  });

  it('skips on a non-sweep day unless forced', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    await expect(runMapsRankSweep({ now: MONDAY_NOON_MX })).resolves.toMatchObject({
      skipped: 'not_sweep_day',
    });
  });

  it('keeps going after one restaurant throws', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    state.joinRows = [
      { id: 1, placeId: 'place-bad', keyword: 'restaurante leon' },
      { id: 2, placeId: 'place-good', keyword: 'restaurante leon' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('place-bad')) throw new TypeError('fetch failed');
        if (url.endsWith('/places/place-good')) {
          return Response.json({ location: { latitude: CENTER.lat, longitude: CENTER.lng } });
        }
        if (init?.method === 'POST') return Response.json({ places: [{ id: 'place-good' }] });
        return new Response('', { status: 404 });
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runMapsRankSweep({ now: SUNDAY_NOON_MX, concurrency: 2 });
    // The mocked db has no group-share query chain, so the group sweep throws and must be contained.
    expect(result).toEqual({ restaurants: 2, samples: 9, failed: 1, group: { failed: -1 } });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].every((r) => r.restaurantId === 2)).toBe(true);
  });

  function stubPlaces() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Response.json({ places: [] });
        if (url.includes('/places/')) {
          return Response.json({ location: { latitude: CENTER.lat, longitude: CENTER.lng } });
        }
        return new Response('', { status: 404 });
      }),
    );
  }

  const mixedRows = [
    { id: 1, placeId: 'p1', keyword: 'pizzería Los Mochis', groupKey: null, subscriptionStatus: 'canceled', locationsBand: '1' },
    { id: 2, placeId: 'p2', keyword: 'pizzería Los Mochis', groupKey: null, subscriptionStatus: 'trialing', locationsBand: '1' },
    { id: 3, placeId: 'p3', keyword: 'mariscos León', groupKey: null, subscriptionStatus: 'active', locationsBand: null },
    { id: 4, placeId: 'p4', keyword: 'cortes León', groupKey: 'estancia', subscriptionStatus: 'canceled', locationsBand: null },
  ];

  it('weekly sweep skips free self-serve restaurants but keeps trial, paid and group ones', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    state.joinRows = mixedRows;
    stubPlaces();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runMapsRankSweep({ now: SUNDAY_NOON_MX, concurrency: 2 });
    expect(result.restaurants).toBe(3);
    const swept = new Set(state.inserts.flat().map((r) => r.restaurantId));
    expect(swept).toEqual(new Set([2, 3, 4]));
  });

  it('restaurantId filters the query, sweeps even a free restaurant and skips the group sweep', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    state.wheres.length = 0;
    state.joinRows = [mixedRows[0]];
    stubPlaces();

    const result = await runMapsRankSweep({ restaurantId: 1, force: true, now: MONDAY_NOON_MX });
    expect(result).toEqual({ restaurants: 1, samples: 9, failed: 0 });
    expect(result).not.toHaveProperty('group');
    const { sql: text, params } = new PgDialect().sqlToQuery(state.wheres[0] as never);
    expect(text).toContain('"restaurants"."id" = $');
    expect(params).toContain(1);
  });

  it('without restaurantId the query has no restaurant id filter', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'true');
    state.wheres.length = 0;
    state.joinRows = [];
    await runMapsRankSweep({ now: SUNDAY_NOON_MX });
    const { sql: text } = new PgDialect().sqlToQuery(state.wheres[0] as never);
    expect(text).not.toContain('"restaurants"."id" = $');
  });

  it('restaurantId does nothing when MAPS_RANK_ENABLED is off', async () => {
    vi.stubEnv('MAPS_RANK_ENABLED', 'false');
    state.wheres.length = 0;
    await expect(runMapsRankSweep({ restaurantId: 1, force: true })).resolves.toMatchObject({
      skipped: 'disabled',
    });
    expect(state.wheres).toHaveLength(0);
  });
});

describe('summarizeSamples', () => {
  it('excludes errors from measured and reads the previous run', () => {
    const rows = [
      { keyword: 'restaurante leon', runDate: '2026-10-04', status: 'found', rank: 2 },
      { keyword: 'restaurante leon', runDate: '2026-10-04', status: 'found', rank: 8 },
      { keyword: 'restaurante leon', runDate: '2026-10-04', status: 'error', rank: null },
      { keyword: 'restaurante leon', runDate: '2026-10-11', status: 'found', rank: 1 },
      { keyword: 'restaurante leon', runDate: '2026-10-11', status: 'not_returned', rank: null },
      { keyword: 'restaurante leon', runDate: '2026-10-11', status: 'error', rank: null },
      { keyword: 'restaurante leon', runDate: '2026-10-11', status: 'found', rank: 15 },
    ];
    expect(summarizeSamples(rows)).toEqual([
      {
        keyword: 'restaurante leon',
        measured: 3,
        top3: 1,
        top10: 1,
        found: 2,
        bestRank: 1,
        prevTop3: 1,
        runDate: '2026-10-11',
        prevRunDate: '2026-10-04',
      },
    ]);
  });

  it('returns null previous fields when a keyword has only one run', () => {
    const [summary] = summarizeSamples([
      { keyword: 'mariscos leon', runDate: '2026-10-11', status: 'not_returned', rank: null },
    ]);
    expect(summary.prevTop3).toBeNull();
    expect(summary.prevRunDate).toBeNull();
    expect(summary.bestRank).toBeNull();
    expect(summary.measured).toBe(1);
  });
});

describe('isSweepDay', () => {
  it('is true only on Sunday in Mexico City', () => {
    expect(isSweepDay(SUNDAY_NOON_MX)).toBe(true);
    expect(isSweepDay(MONDAY_NOON_MX)).toBe(false);
  });
});

describe('defaultKeywords', () => {
  it('uses steakhouse keywords for steak brands', () => {
    expect(defaultKeywords({ city: 'León', brand: 'estancia' })).toEqual([
      'restaurante de cortes León',
      'cortes argentinos León',
      'restaurante argentino León',
    ]);
  });

  it('uses seafood keywords for harbors', () => {
    expect(defaultKeywords({ city: 'Veracruz', brand: 'harbors' })).toEqual([
      'mariscos Veracruz',
      'restaurante de mariscos Veracruz',
    ]);
  });

  it('returns nothing for an unknown brand', () => {
    expect(defaultKeywords({ city: 'Juárez', brand: null })).toEqual([]);
  });

  it('returns nothing without a city', () => {
    expect(defaultKeywords({ city: null, brand: 'estancia' })).toEqual([]);
  });

  describe('self-serve (groupKey null)', () => {
    const profile = (primaryType: string | null) => ({
      primaryType,
      types: [],
      fetchedAt: '2026-10-13T00:00:00.000Z',
    });
    const selfServe = (city: string | null, googleProfile?: unknown) =>
      defaultKeywords({ city, brand: null, groupKey: null, googleProfile });

    it.each([
      ['seafood_restaurant', 'Caltzontzin', 'marisquería Caltzontzin'],
      ['pizza_restaurant', 'Los Mochis', 'pizzería Los Mochis'],
      ['taco_restaurant', 'León', 'taquería León'],
      ['sushi_restaurant', 'León', 'restaurante León'],
    ])('%s becomes one keyword', (type, city, expected) => {
      expect(selfServe(city, profile(type))).toEqual([expected]);
    });

    it('falls back to "restaurante {city}" with no profile or a bad one', () => {
      expect(selfServe('Puebla')).toEqual(['restaurante Puebla']);
      expect(selfServe('Puebla', null)).toEqual(['restaurante Puebla']);
      expect(selfServe('Puebla', { primaryType: 'pizza_restaurant' })).toEqual(['restaurante Puebla']);
    });

    it('returns nothing without a city', () => {
      expect(selfServe(null, profile('pizza_restaurant'))).toEqual([]);
      expect(selfServe('  ', profile('pizza_restaurant'))).toEqual([]);
    });

    it('leaves group and brand keywords byte-identical', () => {
      expect(defaultKeywords({ city: 'León', brand: 'estancia', groupKey: 'estancia' })).toEqual([
        'restaurante de cortes León',
        'cortes argentinos León',
        'restaurante argentino León',
      ]);
      expect(defaultKeywords({ city: 'Juárez', brand: null, groupKey: 'estancia' })).toEqual([]);
      expect(defaultKeywords({ city: 'Juárez', brand: null })).toEqual([]);
    });
  });
});

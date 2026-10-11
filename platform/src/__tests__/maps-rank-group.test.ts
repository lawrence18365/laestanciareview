import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restaurants } from '@/db/schema';

const state = vi.hoisted(() => ({
  locationRows: [] as Array<{ id: number; name: string; city: string | null; placeId: string | null }>,
  keywordRows: [] as Array<{ restaurantId: number; keyword: string }>,
  inserts: [] as Array<Array<{ city: string; keyword: string; gridPoint: number; status: string; groupTop3: number; holderIds: number[] }>>,
  locations: {} as Record<string, { lat: number; lng: number }>,
  responder: (_keyword: string, _lat: number): string[] | null => ['pa', 'x', 'pb', 'y'],
}));

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => (table === restaurants ? state.locationRows : state.keywordRows),
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

import { runGroupShareSweep, summarizeGroupShare } from '@/lib/maps-rank-group';
import { searchTopIds } from '@/lib/maps-rank';

type Row = Parameters<typeof summarizeGroupShare>[0][number];

function row(overrides: Partial<Row> & Pick<Row, 'city' | 'keyword' | 'runDate'>): Row {
  return { status: 'ok', groupTop3: 0, holderIds: [], ...overrides };
}

describe('summarizeGroupShare', () => {
  const names = new Map([
    [1, 'Centro'],
    [2, 'Norte'],
  ]);

  it('rounds the average to one decimal and counts points with any or two-plus holders', () => {
    const rows = [1, 2, 2, 0].map((groupTop3) =>
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3 }),
    );
    const [summary] = summarizeGroupShare(rows, names);
    expect(summary).toMatchObject({ measured: 4, avgTop3: 1.3, pointsAny: 3, pointsTwoPlus: 2 });
  });

  it('counts holders by restaurant and resolves names', () => {
    const rows = [
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 2, holderIds: [1, 2] }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 1, holderIds: [1] }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 0 }),
    ];
    const [summary] = summarizeGroupShare(rows, names);
    expect(summary.holders).toEqual([
      { restaurantId: 1, name: 'Centro', points: 2 },
      { restaurantId: 2, name: 'Norte', points: 1 },
    ]);
  });

  it('excludes error rows from measured, average and holders', () => {
    const rows = [
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 2, holderIds: [1, 2] }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', status: 'error', groupTop3: 3, holderIds: [9] }),
    ];
    const [summary] = summarizeGroupShare(rows, names);
    expect(summary).toMatchObject({ measured: 1, avgTop3: 2, pointsAny: 1 });
    expect(summary.holders.map((h) => h.restaurantId)).toEqual([1, 2]);
  });

  it('compares the latest run with the previous run, and a previous run with no measurements gives null', () => {
    const rows = [
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-04', groupTop3: 0 }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 2 }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 2 }),
      row({ city: 'Puebla', keyword: 'mariscos', runDate: '2026-10-04', status: 'error' }),
      row({ city: 'Puebla', keyword: 'mariscos', runDate: '2026-10-11', groupTop3: 1 }),
    ];
    const summaries = summarizeGroupShare(rows, names);
    const cortes = summaries.find((s) => s.keyword === 'cortes');
    const mariscos = summaries.find((s) => s.keyword === 'mariscos');
    expect(cortes).toMatchObject({ runDate: '2026-10-11', prevRunDate: '2026-10-04', avgTop3: 2, prevAvgTop3: 0 });
    expect(mariscos).toMatchObject({ prevRunDate: '2026-10-04', prevAvgTop3: null });
  });

  it('sorts by city, then average descending', () => {
    const rows = [
      row({ city: 'Querétaro', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 1 }),
      row({ city: 'Puebla', keyword: 'cortes', runDate: '2026-10-11', groupTop3: 0 }),
      row({ city: 'Puebla', keyword: 'mariscos', runDate: '2026-10-11', groupTop3: 3 }),
    ];
    const summaries = summarizeGroupShare(rows, names);
    expect(summaries.map((s) => `${s.city}/${s.keyword}`)).toEqual([
      'Puebla/mariscos',
      'Puebla/cortes',
      'Querétaro/cortes',
    ]);
  });
});

describe('runGroupShareSweep', () => {
  beforeEach(() => {
    state.inserts.length = 0;
    state.locationRows = [];
    state.keywordRows = [];
    state.locations = {};
    state.responder = () => ['pa', 'x', 'pb', 'y'];
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as {
            textQuery: string;
            locationBias: { circle: { center: { latitude: number } } };
          };
          const ids = state.responder(body.textQuery, body.locationBias.circle.center.latitude);
          if (ids === null) return new Response('', { status: 500 });
          return Response.json({ places: ids.map((id) => ({ id })) });
        }
        const placeId = decodeURIComponent(url.split('/places/')[1]);
        const loc = state.locations[placeId];
        if (!loc) return new Response('', { status: 404 });
        return Response.json({ location: { latitude: loc.lat, longitude: loc.lng } });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps only our restaurant ids among the top 3, in rank order', async () => {
    state.locationRows = [
      { id: 1, name: 'Centro', city: 'Puebla', placeId: 'pa' },
      { id: 2, name: 'Norte', city: 'Puebla', placeId: 'pb' },
    ];
    state.keywordRows = [{ restaurantId: 1, keyword: 'cortes argentinos Puebla' }];
    state.locations = { pa: { lat: 19.04, lng: -98.2 }, pb: { lat: 19.05, lng: -98.21 } };

    // Default responder: ours at ranks 1 and 3, a competitor at rank 2 (dropped), and another at rank 4 (outside the top 3).
    await expect(runGroupShareSweep('2026-10-11')).resolves.toEqual({ cities: 1, samples: 9, failed: 0 });
    const rows = state.inserts.flat();
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      expect(r).toMatchObject({ city: 'Puebla', status: 'ok', groupTop3: 2, holderIds: [1, 2] });
    }
  });

  it('stores a failed search as an error and a competitor-only top 3 as zero', async () => {
    state.locationRows = [{ id: 1, name: 'Centro', city: 'Puebla', placeId: 'pa' }];
    state.keywordRows = [{ restaurantId: 1, keyword: 'cortes argentinos Puebla' }];
    state.locations = { pa: { lat: 19.04, lng: -98.2 } };
    let call = 0;
    state.responder = () => {
      call++;
      if (call === 1) return null;
      if (call === 2) return ['c1', 'c2', 'c3'];
      return ['pa', 'x'];
    };

    await runGroupShareSweep('2026-10-11');
    const rows = state.inserts.flat();
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.status === 'error')).toEqual([
      expect.objectContaining({ groupTop3: 0, holderIds: [] }),
    ]);
    expect(rows.filter((r) => r.status === 'ok' && r.groupTop3 === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'ok' && r.groupTop3 === 1)).toHaveLength(7);
  });

  it('isolates a city whose center cannot be fetched and keeps sweeping the others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.locationRows = [
      { id: 1, name: 'Centro', city: 'Puebla', placeId: 'pa' },
      { id: 3, name: 'Sur', city: 'Querétaro', placeId: 'pq' },
    ];
    state.keywordRows = [
      { restaurantId: 1, keyword: 'cortes argentinos Puebla' },
      { restaurantId: 3, keyword: 'restaurante argentino Querétaro' },
    ];
    // 'pa' has no location, so Puebla fails. Querétaro has one.
    state.locations = { pq: { lat: 20.59, lng: -100.39 } };

    await expect(runGroupShareSweep('2026-10-11')).resolves.toEqual({ cities: 1, samples: 9, failed: 1 });
    const rows = state.inserts.flat();
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.city === 'Querétaro')).toBe(true);
  });
});

describe('searchTopIds', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const point = { lat: 19.04, lng: -98.2 };

  it('returns place ids in Maps order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ places: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })));
    await expect(searchTopIds('cortes', point)).resolves.toEqual(['a', 'b', 'c']);
  });

  it('returns null on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(searchTopIds('cortes', point)).resolves.toBeNull();
  });

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(searchTopIds('cortes', point)).resolves.toBeNull();
  });
});

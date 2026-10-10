import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updatedRatings: [] as string[],
}));

vi.mock('@/db', () => {
  function query(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'where', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return builder;
  }

  return {
    db: {
      select: vi.fn(() => query((mocks.selectRows.shift() ?? []) as unknown[])),
      update: vi.fn(() => ({
        set: vi.fn((values: { googleRating: string }) => ({
          where: vi.fn(async () => {
            mocks.updatedRatings.push(values.googleRating);
          }),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    },
  };
});

import { refreshAllGoogleRatings } from '@/lib/google-places';

const restaurantRows = [
  { id: 1, placeId: 'place-1', lastUpdated: null },
  { id: 2, placeId: 'place-2', lastUpdated: null },
  { id: 3, placeId: 'place-3', lastUpdated: null },
];

const ratingsByPlace: Record<string, number> = { 'place-1': 4.1, 'place-3': 4.3 };

describe('refreshAllGoogleRatings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    mocks.selectRows = [restaurantRows];
    mocks.updatedRatings = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock = vi.fn(async (url: string) => {
      const placeId = new URL(url).searchParams.get('place_id') ?? '';
      if (placeId === 'place-2') throw new TypeError('fetch failed');
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          result: { rating: ratingsByPlace[placeId], user_ratings_total: 100 },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('keeps refreshing restaurants 1 and 3 when restaurant 2 fetch throws', async () => {
    const summary = await refreshAllGoogleRatings(0);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.updatedRatings).toEqual(['4.1', '4.3']);
    expect(summary).toEqual({ refreshed: 2, failed: 1 });
  });

  it('logs the failed restaurant id and error code without the API key', async () => {
    await refreshAllGoogleRatings(0);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain('restaurant 2');
    expect(message).toContain('TypeError');
    expect(message).not.toContain('test-key');
  });
});

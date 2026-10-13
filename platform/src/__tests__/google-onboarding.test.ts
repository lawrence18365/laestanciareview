import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOnboardingGoogleData } from '@/lib/google-onboarding';
import { getNearbyCompetitors, haversineMeters } from '@/lib/competitors';

const detailsBody = {
  rating: 4.6,
  userRatingCount: 87,
  primaryType: 'pizza_restaurant',
  types: ['pizza_restaurant', 'restaurant', 'food'],
  takeout: true,
  delivery: true,
  dineIn: false,
  location: { latitude: 21.12, longitude: -101.68 },
  formattedAddress: 'Calle 1, León, Gto., México',
};

function nearby(results: unknown[]) {
  return { status: 'OK', results };
}

const place = (id: string, name: string, rating: number | undefined, total: number, dLat = 0.001) => ({
  place_id: id,
  name,
  rating,
  user_ratings_total: total,
  geometry: { location: { lat: 21.12 + dLat, lng: -101.68 } },
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('fetchOnboardingGoogleData', () => {
  const fetchMock = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'secret-key-123');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps every field and keeps the top 3 competitors by review count', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('https://places.googleapis.com/v1/places/')
        ? jsonResponse(detailsBody)
        : jsonResponse(nearby([
            place('self', 'Mi Pizza', 4.6, 87),
            place('a', 'A', 4.1, 48),
            place('b', 'B', 4.5, 310, 0.004),
            place('c', 'C', 3.9, 120),
            place('d', 'D', 4.8, 15),
            place('e', 'Sin rating', undefined, 900),
            place('f', 'Pocas', 5, 9),
          ])),
    );

    const out = await fetchOnboardingGoogleData('self');

    expect(out.rating).toBe('4.6');
    expect(out.reviewCount).toBe(87);
    expect(out.profile).toMatchObject({
      primaryType: 'pizza_restaurant',
      types: ['pizza_restaurant', 'restaurant', 'food'],
      takeout: true,
      delivery: true,
      dineIn: false,
      lat: 21.12,
      lng: -101.68,
      formattedAddress: 'Calle 1, León, Gto., México',
    });
    expect(typeof out.profile?.fetchedAt).toBe('string');
    // Excludes self, <10 reviews and unrated. Comparable selection (SQ-214): A, B, C are within
    // 0.5x-4x of the own 87 reviews and D (15) is not; closest first, so B (farthest) is last.
    expect(out.profile?.competitors.map((c) => [c.name, c.reviewCount])).toEqual([
      ['C', 120],
      ['A', 48],
      ['B', 310],
    ]);
    expect(out.profile?.competitors[2]).toMatchObject({ rating: 4.5 });
    expect(out.profile?.competitors[2].distanceM).toBeGreaterThan(400);

    // Details call: Places v1 GET with the exact field mask and the key in a header, not the URL.
    const [detailsUrl, detailsInit] = fetchMock.mock.calls[0];
    expect(detailsUrl).toBe('https://places.googleapis.com/v1/places/self');
    expect(detailsInit.headers['X-Goog-FieldMask']).toBe(
      'rating,userRatingCount,primaryType,types,takeout,delivery,dineIn,location,formattedAddress',
    );
    expect(detailsInit.headers['X-Goog-Api-Key']).toBe('secret-key-123');
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns nulls on an HTTP error and logs a code only', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'secret-key-123 denied' } }, 403));
    const out = await fetchOnboardingGoogleData('self');
    expect(out).toEqual({ rating: null, reviewCount: null, profile: null });
    expect(warn).toHaveBeenCalledWith('[google-onboarding] code=http_403');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-key-123');
  });

  it('returns nulls when the 3s budget runs out', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {})); // never settles
    const pending = fetchOnboardingGoogleData('self');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ rating: null, reviewCount: null, profile: null });
    expect(warn).toHaveBeenCalledWith('[google-onboarding] code=timeout');
  });

  it('aborts the in-flight request when the budget runs out', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    const pending = fetchOnboardingGoogleData('self');
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(signal?.aborted).toBe(true);
  });

  it('returns nulls when the competitor search fails, and with no key', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('https://places.googleapis.com')) return jsonResponse(detailsBody);
      throw new Error('network down');
    });
    expect(await fetchOnboardingGoogleData('self')).toEqual({ rating: null, reviewCount: null, profile: null });

    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    fetchMock.mockClear();
    expect(await fetchOnboardingGoogleData('self')).toEqual({ rating: null, reviewCount: null, profile: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a profile with null numbers for a place that has no reviews yet', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('https://places.googleapis.com')
        ? jsonResponse({ ...detailsBody, rating: undefined, userRatingCount: undefined })
        : jsonResponse(nearby([])),
    );
    const out = await fetchOnboardingGoogleData('self');
    expect(out.rating).toBeNull();
    expect(out.reviewCount).toBeNull();
    expect(out.profile?.competitors).toEqual([]);
  });
});

describe('getNearbyCompetitors', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'k');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('queries legacy nearbysearch (restaurant, 3000 m) and excludes self / unrated / <10 reviews', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nearby([
      place('self', 'Self', 4.5, 100),
      place('x', 'X', 4.0, 10),
      place('y', 'Y', 4.2, 9),
      place('z', 'Z', undefined, 50),
    ])));
    const out = await getNearbyCompetitors(21.12, -101.68, 'self', { revalidate: 86400 });
    expect(out.map((p) => p.placeId)).toEqual(['x']);
    expect(out[0]).toMatchObject({ name: 'X', rating: 4, userRatingsTotal: 10 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/place/nearbysearch/json?location=21.12,-101.68&radius=3000&type=restaurant');
    expect(init).toEqual({ next: { revalidate: 86400 } });
  });

  it('computes haversine distance and tolerates missing geometry', async () => {
    fetchMock.mockResolvedValue(jsonResponse(nearby([
      place('x', 'X', 4, 20, 0.009),
      { place_id: 'g', name: 'G', rating: 4, user_ratings_total: 20 },
    ])));
    const out = await getNearbyCompetitors(21.12, -101.68, 'self');
    expect(out[0].distanceM).toBeGreaterThan(950);
    expect(out[0].distanceM).toBeLessThan(1050);
    expect(out[1].distanceM).toBeNull();
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });

  it('returns [] without a key and does not call Google', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    expect(await getNearbyCompetitors(1, 1, 'x')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

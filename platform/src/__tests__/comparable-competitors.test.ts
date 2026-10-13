import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findComparableCompetitors,
  getNearbyCompetitors,
  isKnownChain,
  selectComparableCompetitors,
  type ComparableCandidate,
} from '@/lib/competitors';
import { fetchOnboardingGoogleData } from '@/lib/google-onboarding';

const cand = (
  name: string,
  total: number,
  distanceM: number | null,
  extra: Partial<ComparableCandidate> = {},
): ComparableCandidate => ({
  placeId: name,
  name,
  rating: 4.2,
  userRatingsTotal: total,
  distanceM,
  types: ['restaurant', 'food'],
  ...extra,
});

const own = { reviewCount: 53, primaryType: 'mexican_restaurant', types: ['mexican_restaurant', 'restaurant'] };

describe('selectComparableCompetitors', () => {
  it('La Privada-like: skips chains and giants, returns the local fondas', () => {
    const out = selectComparableCompetitors(own, [
      cand('Toks', 3850, 100),
      cand('KFC', 3090, 150),
      cand('La Mansión', 3691, 200),
      cand('Fonda Doña Mary', 40, 600),
      cand('Cocina Lupita', 90, 900),
      cand('Fonda El Güero', 120, 1200),
    ]);
    expect(out.map((c) => c.name)).toEqual(['Fonda Doña Mary', 'Cocina Lupita', 'Fonda El Güero']);
  });

  it('prefers the same category over a closer place of another category', () => {
    const out = selectComparableCompetitors(own, [
      cand('Pizzas Cerca', 60, 100, { types: ['restaurant', 'pizza_restaurant'] }),
      cand('Fonda A', 60, 300, { keywordMatch: true }),
      cand('Antojitos B', 70, 500, { types: ['restaurant', 'mexican_restaurant'] }),
      cand('Cafe C', 50, 200, { types: ['cafe', 'restaurant'] }),
    ]);
    // Same category (keyword or shared specific type) first, by distance; then the rest.
    expect(out.map((c) => c.name)).toEqual(['Fonda A', 'Antojitos B', 'Pizzas Cerca']);
  });

  it('prefers a review count within 0.5x-4x of its own, then the closest', () => {
    const out = selectComparableCompetitors(
      { reviewCount: 100, primaryType: null, types: [] },
      [
        cand('Tiny', 12, 50), // under 0.5x
        cand('Big', 900, 60), // over 4x, under 10x
        cand('Fit far', 150, 2000),
        cand('Fit near', 200, 800),
        cand('Fit mid', 60, 1500),
      ],
    );
    expect(out.map((c) => c.name)).toEqual(['Fit near', 'Fit mid', 'Fit far']);
  });

  it('floors a tiny own count at 20 for the review window', () => {
    const out = selectComparableCompetitors(
      { reviewCount: 3, primaryType: null, types: [] },
      [cand('Fit', 30, 900), cand('Out', 150, 100)],
    );
    // base 20: window 10-80. 30 fits even though 3 x 4 = 12 would not; 150 is over 4x the floor.
    expect(out.map((c) => c.name)).toEqual(['Fit', 'Out']);
    const strict = selectComparableCompetitors(
      { reviewCount: 3, primaryType: null, types: [] },
      [cand('Huge', 500, 10), cand('Fit', 30, 900)],
    );
    // 500 is over 10x the floored 20 (=200): treated as a giant and used only as filler.
    expect(strict.map((c) => c.name)).toEqual(['Fit', 'Huge']);
  });

  it('with fewer than 3 qualifying, fills with the closest non-chain places (never chains)', () => {
    const out = selectComparableCompetitors(own, [
      cand('Local', 80, 700),
      cand('Starbucks', 4000, 10),
      cand('Gran Restaurante', 2000, 300),
      cand('Otro Grande', 900, 500),
    ]);
    expect(out.map((c) => c.name)).toEqual(['Local', 'Gran Restaurante', 'Otro Grande']);
    expect(selectComparableCompetitors(own, [cand("McDonald's", 5000, 10)])).toEqual([]);
  });

  it('matches chains by whole words, ignoring case, accents and apostrophes', () => {
    expect(isKnownChain('TOKS Galerías')).toBe(true);
    expect(isKnownChain('Domino’s Pizza')).toBe(true);
    expect(isKnownChain('El Portón Mexicano')).toBe(true);
    expect(isKnownChain('Carls Jr.')).toBe(true);
    expect(isKnownChain('Tokstop Tacos')).toBe(false);
    expect(isKnownChain('Taquería Los Wingsters')).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const apiPlace = (id: string, name: string, total: number, dLat: number, types?: string[]) => ({
  place_id: id,
  name,
  rating: 4.3,
  user_ratings_total: total,
  types,
  geometry: { location: { lat: 21.12 + dLat, lng: -101.68 } },
});

describe('findComparableCompetitors / onboarding (mock fetch)', () => {
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

  it('runs one extra keyword search for a specific category and uses it to prefer that category', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      const keyworded = u.includes('keyword=');
      return jsonResponse({
        results: keyworded
          ? [apiPlace('p2', 'Pizza Nonna', 70, 0.006)]
          : [
              apiPlace('p1', 'Taquería Cerca', 60, 0.001),
              apiPlace('p2', 'Pizza Nonna', 70, 0.006),
              apiPlace('p3', 'Fonda Cerca', 55, 0.002),
              apiPlace('p4', 'Cafe Cerca', 50, 0.003),
            ],
      });
    });
    const out = await findComparableCompetitors(21.12, -101.68, 'self', {
      reviewCount: 60,
      primaryType: 'pizza_restaurant',
      types: ['pizza_restaurant', 'restaurant'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('keyword=pizzer%C3%ADa'))).toHaveLength(1);
    expect(urls.every((u) => u.includes('radius=3000') && u.includes('type=restaurant'))).toBe(true);
    // The pizzeria is farthest but is the only same-category place, so it comes first.
    expect(out.map((c) => c.name)).toEqual(['Pizza Nonna', 'Taquería Cerca', 'Fonda Cerca']);
    expect(Object.keys(out[0]).sort()).toEqual(['distanceM', 'name', 'rating', 'reviewCount']);
  });

  it('makes no extra call for the generic category, and survives a failed keyword search', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [apiPlace('p1', 'Uno', 60, 0.001)] }));
    await findComparableCompetitors(21.12, -101.68, 'self', {
      reviewCount: 60,
      primaryType: 'restaurant',
      types: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('keyword=')) throw new Error('boom');
      return jsonResponse({ results: [apiPlace('p1', 'Uno', 60, 0.001)] });
    });
    const out = await findComparableCompetitors(21.12, -101.68, 'self', {
      reviewCount: 60,
      primaryType: 'pizza_restaurant',
      types: [],
    });
    expect(out.map((c) => c.name)).toEqual(['Uno']);
  });

  it('onboarding: La Privada-like place gets local competitors, not the chains', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.startsWith('https://places.googleapis.com/v1/places/')) {
        return jsonResponse({
          rating: 4.5,
          userRatingCount: 53,
          primaryType: 'mexican_restaurant',
          types: ['mexican_restaurant', 'restaurant'],
          location: { latitude: 21.12, longitude: -101.68 },
        });
      }
      return jsonResponse({
        results: [
          apiPlace('t', 'Toks', 3850, 0.001),
          apiPlace('k', 'KFC', 3090, 0.001),
          apiPlace('m', 'La Mansión', 3691, 0.002),
          apiPlace('f1', 'Fonda 1', 40, 0.003),
          apiPlace('f2', 'Fonda 2', 90, 0.004),
          apiPlace('f3', 'Fonda 3', 120, 0.005),
        ],
      });
    });
    const out = await fetchOnboardingGoogleData('self');
    expect(out.profile?.competitors.map((c) => c.name)).toEqual(['Fonda 1', 'Fonda 2', 'Fonda 3']);
  });
});

describe('audit behavior is unchanged', () => {
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

  it('getNearbyCompetitors without options keeps the exact URL (no keyword), filters and Google order', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          apiPlace('big', 'Toks', 3850, 0.001),
          apiPlace('small', 'Fonda', 12, 0.002),
          { ...apiPlace('unrated', 'Sin rating', 500, 0.003), rating: undefined },
          apiPlace('few', 'Pocas', 9, 0.003),
          apiPlace('self', 'Self', 100, 0.003),
        ],
      }),
    );
    const out = await getNearbyCompetitors(21.12, -101.68, 'self', { revalidate: 86400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=21.12,-101.68&radius=3000&type=restaurant&key=k',
    );
    // Chains and giants are kept here: only onboarding applies the comparable selection.
    expect(out.map((p) => p.name)).toEqual(['Toks', 'Fonda']);
  });
});

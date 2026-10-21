import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ checkRateLimitAsync: vi.fn() }));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return { ...actual, checkRateLimitAsync: mocks.checkRateLimitAsync };
});

import { GET } from '@/app/api/places/search/route';

function req(q?: string, headers: Record<string, string> = {}) {
  const url = new URL('https://app.ratetapmx.com/api/places/search');
  if (q !== undefined) url.searchParams.set('q', q);
  return new NextRequest(url, { headers: { 'x-real-ip': '203.0.113.9', ...headers } });
}

const upstreamBody = {
  places: [
    {
      id: 'ChIJabc',
      displayName: { text: 'La Estancia Argentina', languageCode: 'es' },
      formattedAddress: 'Blvd. Campestre 1, León, Gto., México',
      addressComponents: [
        { longText: 'León de los Aldama', types: ['locality', 'political'] },
        { longText: 'Guanajuato', types: ['administrative_area_level_1', 'political'] },
        { longText: 'México', types: ['country', 'political'] },
      ],
    },
    { displayName: { text: 'No id, dropped' } },
  ],
};

describe('GET /api/places/search', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '"server-key\\n"');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mocks.checkRateLimitAsync.mockReset().mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 1000 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects a missing, too-short, or too-long query without calling Google', async () => {
    for (const q of [undefined, '', '  ab  ', 'x'.repeat(201)]) {
      const res = await GET(req(q));
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the Places response to {placeId, name, address, city, state} and sends the right request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(upstreamBody), { status: 200 }));
    const res = await GET(req('  la estancia  '));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual([
      {
        placeId: 'ChIJabc',
        name: 'La Estancia Argentina',
        address: 'Blvd. Campestre 1, León, Gto., México',
        city: 'León de los Aldama',
        state: 'Guanajuato',
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.headers['X-Goog-Api-Key']).toBe('server-key');
    expect(init.headers['X-Goog-FieldMask']).toBe(
      'places.id,places.displayName,places.formattedAddress,places.addressComponents',
    );
    expect(JSON.parse(init.body)).toEqual({
      textQuery: 'la estancia',
      pageSize: 5,
      languageCode: 'es',
      regionCode: 'MX',
    });
  });

  it('returns an empty list when Google finds nothing', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await GET(req('xyzzy restaurante'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('answers 502 when Google returns an error status, without leaking the key', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"bad key server-key"}', { status: 403 }));
    const res = await GET(req('la estancia'));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('server-key');
  });

  it('answers 502 when the Google request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await GET(req('la estancia'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 when the server key is not configured', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    const res = await GET(req('la estancia'));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('fallback for address-typed queries', () => {
    const empty = () => new Response('{}', { status: 200 });
    const found = () => new Response(JSON.stringify(upstreamBody), { status: 200 });
    const sentQueries = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).textQuery);
    const LA_PRIVADA = 'LA PRIVADA, calle privada de san Andres mz 1 lt 3';

    function reqWith(q: string, city?: string) {
      const url = new URL('https://app.ratetapmx.com/api/places/search');
      url.searchParams.set('q', q);
      if (city !== undefined) url.searchParams.set('city', city);
      return new NextRequest(url, { headers: { 'x-real-ip': '203.0.113.9' } });
    }

    it('does not retry when the first query finds something', async () => {
      fetchMock.mockResolvedValue(found());
      const res = await GET(reqWith(LA_PRIVADA));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((await res.json()).length).toBe(1);
      expect(res.headers.get('x-places-retried')).toBeNull();
    });

    it('retries once with just the name when the first query finds nothing', async () => {
      fetchMock.mockResolvedValueOnce(empty()).mockResolvedValueOnce(found());
      const res = await GET(reqWith(LA_PRIVADA));
      expect(sentQueries()).toEqual([LA_PRIVADA, 'LA PRIVADA']);
      expect(res.status).toBe(200);
      expect((await res.json())[0].placeId).toBe('ChIJabc');
      expect(res.headers.get('x-places-retried')).toBe('1');
    });

    it('makes at most two upstream calls, even when the retry is empty too', async () => {
      fetchMock.mockImplementation(async () => empty());
      const res = await GET(reqWith(LA_PRIVADA));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await res.json()).toEqual([]);
      expect(res.headers.get('x-places-retried')).toBe('1');
      expect(mocks.checkRateLimitAsync).toHaveBeenCalledTimes(1);
    });

    it('searches "<q> <city>" first when the caller passes a city, then plain q', async () => {
      fetchMock.mockImplementation(async () => empty());
      const res = await GET(reqWith(LA_PRIVADA, 'Ecatepec'));
      expect(sentQueries()).toEqual([`${LA_PRIVADA} Ecatepec`, LA_PRIVADA]);
      expect(res.headers.get('x-places-retried')).toBe('1');
    });

    it('ignores a city over 60 characters', async () => {
      fetchMock.mockImplementation(async () => empty());
      await GET(reqWith(LA_PRIVADA, 'x'.repeat(61)));
      expect(sentQueries()[1]).toBe('LA PRIVADA');
    });

    it('strips street words and number tokens from the name part', async () => {
      fetchMock.mockImplementation(async () => empty());
      await GET(reqWith('Tacos Beto Av. Juárez 123 # 5'));
      expect(sentQueries()[1]).toBe('Tacos Beto Juárez');
    });

    it('does not retry when nothing would change', async () => {
      fetchMock.mockImplementation(async () => empty());
      const res = await GET(reqWith('xyzzy restaurante'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.headers.get('x-places-retried')).toBe('0');
    });

    it('does not retry when only street words remain', async () => {
      fetchMock.mockImplementation(async () => empty());
      await GET(reqWith('Calle 5, Centro'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on an upstream error, and returns an empty list if only the retry fails', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
      expect((await GET(reqWith(LA_PRIVADA))).status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(empty()).mockRejectedValueOnce(new Error('network down'));
      const res = await GET(reqWith(LA_PRIVADA));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('city bias', () => {
    const empty = () => new Response('{}', { status: 200 });
    const found = () => new Response(JSON.stringify(upstreamBody), { status: 200 });
    const sentQueries = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).textQuery);

    function reqWith(q: string, city?: string) {
      const url = new URL('https://app.ratetapmx.com/api/places/search');
      url.searchParams.set('q', q);
      if (city !== undefined) url.searchParams.set('city', city);
      return new NextRequest(url, { headers: { 'x-real-ip': '203.0.113.9' } });
    }

    // "Los asaditos" alone once returned a listing in another state.
    it('searches the query with the city first, and finds it in one call', async () => {
      fetchMock.mockResolvedValue(found());
      const res = await GET(reqWith('Los asaditos', 'Morelia'));
      expect(sentQueries()).toEqual(['Los asaditos Morelia']);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).textQuery).toBe('Los asaditos Morelia');
      expect((await res.json())[0].placeId).toBe('ChIJabc');
      expect(res.headers.get('x-places-retried')).toBeNull();
    });

    it('falls back to the plain query when the city-scoped search finds nothing', async () => {
      fetchMock.mockResolvedValueOnce(empty()).mockResolvedValueOnce(found());
      const res = await GET(reqWith('Los asaditos', 'Morelia'));
      expect(sentQueries()).toEqual(['Los asaditos Morelia', 'Los asaditos']);
      expect((await res.json())[0].placeId).toBe('ChIJabc');
      expect(res.headers.get('x-places-retried')).toBe('1');
    });

    it('does not append a city the query already names, accents and case aside', async () => {
      fetchMock.mockResolvedValue(found());
      const res = await GET(reqWith('la estancia LEON', 'León'));
      expect(sentQueries()).toEqual(['la estancia LEON']);
      expect(res.headers.get('x-places-retried')).toBeNull();
    });

    it('keeps the name-part retry when the query already names the city', async () => {
      fetchMock.mockImplementation(async () => empty());
      await GET(reqWith('Tacos Beto Av. Juárez 123, Morelia', 'Morelia'));
      expect(sentQueries()).toEqual(['Tacos Beto Av. Juárez 123, Morelia', 'Tacos Beto Juárez Morelia']);
    });

    it('never makes more than two upstream calls with a city, whatever the query', async () => {
      fetchMock.mockImplementation(async () => empty());
      await GET(reqWith('LA PRIVADA, calle privada de san Andres mz 1 lt 3', 'Ecatepec'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mocks.checkRateLimitAsync).toHaveBeenCalledTimes(1);
    });

    it('answers 502 when the city-scoped call fails, without a second call', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
      const res = await GET(reqWith('Los asaditos', 'Morelia'));
      expect(res.status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('is unchanged without a city: the query as typed first', async () => {
      fetchMock.mockResolvedValue(found());
      const res = await GET(reqWith('Los asaditos'));
      expect(sentQueries()).toEqual(['Los asaditos']);
      expect(res.headers.get('x-places-retried')).toBeNull();
    });
  });

  it('answers 429 once the per-IP limit is exhausted', async () => {
    mocks.checkRateLimitAsync.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
    const res = await GET(req('la estancia'));
    expect(res.status).toBe(429);
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith('places-search:203.0.113.9', 30, 600_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('location bias and long input', () => {
    const ok = () => new Response(JSON.stringify(upstreamBody), { status: 200 });
    const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

    it('biases the search to the visitor area from Vercel IP headers in Mexico', async () => {
      fetchMock.mockResolvedValue(ok());
      await GET(req('La Privada', {
        'x-vercel-ip-country': 'MX',
        'x-vercel-ip-latitude': '19.6018',
        'x-vercel-ip-longitude': '-99.0507',
      }));
      expect(sentBody().locationBias).toEqual({
        circle: { center: { latitude: 19.6018, longitude: -99.0507 }, radius: 50000 },
      });
    });

    it('sends no bias outside Mexico or without usable coordinates', async () => {
      fetchMock.mockResolvedValue(ok());
      await GET(req('La Privada', { 'x-vercel-ip-country': 'US', 'x-vercel-ip-latitude': '37.7', 'x-vercel-ip-longitude': '-122.4' }));
      await GET(req('La Privada', { 'x-vercel-ip-country': 'MX', 'x-vercel-ip-latitude': 'abc' }));
      await GET(req('La Privada'));
      for (let i = 0; i < 3; i++) expect(sentBody(i).locationBias).toBeUndefined();
    });

    it('searches the name part of a pasted full address instead of rejecting it', async () => {
      fetchMock.mockResolvedValue(ok());
      const res = await GET(req('LA PRIVADA, calle privada de San Andrés, manzana 1, lote 3, colonia Hank González'));
      expect(res.status).toBe(200);
      expect(sentBody().textQuery).toBe('LA PRIVADA');
    });
  });
});

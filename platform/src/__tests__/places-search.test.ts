import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ checkRateLimitAsync: vi.fn() }));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return { ...actual, checkRateLimitAsync: mocks.checkRateLimitAsync };
});

import { GET } from '@/app/api/places/search/route';

function req(q?: string) {
  const url = new URL('https://app.ratetapmx.com/api/places/search');
  if (q !== undefined) url.searchParams.set('q', q);
  return new NextRequest(url, { headers: { 'x-real-ip': '203.0.113.9' } });
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
    for (const q of [undefined, '', '  ab  ', 'x'.repeat(81)]) {
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

  it('answers 429 once the per-IP limit is exhausted', async () => {
    mocks.checkRateLimitAsync.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
    const res = await GET(req('la estancia'));
    expect(res.status).toBe(429);
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith('places-search:203.0.113.9', 30, 600_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

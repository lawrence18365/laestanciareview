import { NextRequest } from 'next/server';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

/**
 * Server-side Google place search for the signup form and Settings, used when
 * the browser Places key is not configured. The server key never leaves this
 * route; callers get only {placeId, name, address, city, state}.
 */

export const runtime = 'nodejs';

const PLACES_BASE = 'https://places.googleapis.com/v1';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents';
const MIN_QUERY = 3;
const MAX_QUERY = 80;
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW = 10 * 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

const NO_STORE = { 'Cache-Control': 'no-store' };

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

// Same sanitising as lib/maps-rank.ts: a pasted env value once arrived as `"KEY\n"` and every call 400'd.
function apiKey(): string {
  return (process.env.GOOGLE_PLACES_API_KEY ?? '').trim().replace(/^"|"$/g, '').replace(/\\n$/, '').trim();
}

type UpstreamPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; types?: string[] }[];
};

function toResult(p: UpstreamPlace) {
  let city = '';
  let state = '';
  for (const comp of p.addressComponents ?? []) {
    if (comp.types?.includes('locality')) city = comp.longText ?? '';
    else if (comp.types?.includes('administrative_area_level_1')) state = comp.longText ?? '';
  }
  return {
    placeId: p.id ?? '',
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    city,
    state,
  };
}

export async function GET(req: NextRequest) {
  const rl = await checkRateLimitAsync(`places-search:${getClientIP(req)}`, SEARCH_LIMIT, SEARCH_WINDOW);
  if (!rl.allowed) {
    const res = rateLimitResponse(rl.resetAt);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return reply({ error: `q must be ${MIN_QUERY}-${MAX_QUERY} characters` }, 400);
  }

  const key = apiKey();
  if (!key) {
    console.error('places-search: GOOGLE_PLACES_API_KEY missing');
    return reply({ error: 'Search unavailable' }, 503);
  }

  try {
    const upstream = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: q, pageSize: 5, languageCode: 'es', regionCode: 'MX' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      console.error(`places-search: upstream ${upstream.status}`);
      return reply({ error: 'Search failed' }, 502);
    }
    const data = (await upstream.json()) as { places?: UpstreamPlace[] };
    const results = (data.places ?? []).map(toResult).filter((r) => r.placeId && r.name);
    return reply(results);
  } catch (err) {
    console.error('places-search: upstream error', err instanceof Error ? err.message : err);
    return reply({ error: 'Search failed' }, 502);
  }
}

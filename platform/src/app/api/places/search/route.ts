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
const MAX_RAW_QUERY = 200;
const MAX_CITY = 60;
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW = 10 * 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
// Without a location Google guesses: "La Privada" found nothing and "Metro
// Pizza" found a shop in Toronto. Biasing to the visitor's IP area puts their
// own restaurant first (verified 2026-10-13 against both).
const BIAS_RADIUS_M = 50_000;

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

type LatLng = { latitude: number; longitude: number };

/** Vercel's IP geolocation headers, when present and inside Mexico. */
function ipLocation(req: NextRequest): LatLng | null {
  if (req.headers.get('x-vercel-ip-country') !== 'MX') return null;
  const latitude = Number(req.headers.get('x-vercel-ip-latitude'));
  const longitude = Number(req.headers.get('x-vercel-ip-longitude'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

async function searchText(textQuery: string, key: string, near: LatLng | null) {
  const upstream = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 5,
      languageCode: 'es',
      regionCode: 'MX',
      ...(near ? { locationBias: { circle: { center: near, radius: BIAS_RADIUS_M } } } : {}),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  const data = (await upstream.json()) as { places?: UpstreamPlace[] };
  return (data.places ?? []).map(toResult).filter((r) => r.placeId && r.name);
}

// Street words (and their dotted forms) that mean the text is an address, not a name.
const STREET_WORDS = new Set([
  'calle', 'av', 'avenida', 'col', 'colonia', 'mz', 'manzana', 'lt', 'lote',
  'numero', 'no', 'num', 'cp', 'c.p',
]);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Whether the city still has to be added. "Los asaditos" alone returns a listing
 * in another state; "Los asaditos Morelia" returns the right one. A query that
 * already names the city (accents and case aside) is left alone.
 */
export function shouldAppendCity(q: string, city: string): boolean {
  if (!city) return false;
  return !stripAccents(q.toLowerCase()).includes(stripAccents(city.toLowerCase()));
}

/**
 * "LA PRIVADA, calle privada de san Andres mz 1 lt 3" -> "LA PRIVADA":
 * keep the text before the first comma, dash or #, drop street words and
 * digit-only tokens, then add the city when the caller has one.
 */
function simplifyQuery(q: string, city: string): string {
  const head = q.split(/[,#-]/)[0];
  const name = head
    .split(/\s+/)
    .filter((t) => {
      const w = stripAccents(t.toLowerCase()).replace(/[.:°º]+$/, '');
      return w && !STREET_WORDS.has(w) && !/^\d+$/.test(w);
    })
    .join(' ')
    .trim();
  if (!name) return '';
  return city ? `${name} ${city}` : name;
}

export async function GET(req: NextRequest) {
  const rl = await checkRateLimitAsync(`places-search:${getClientIP(req)}`, SEARCH_LIMIT, SEARCH_WINDOW);
  if (!rl.allowed) {
    const res = rateLimitResponse(rl.resetAt);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  let q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  // A full street address pasted into the name box runs long; search its name part.
  if (q.length > MAX_QUERY && q.length <= MAX_RAW_QUERY) q = simplifyQuery(q, '').slice(0, MAX_QUERY).trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return reply({ error: `q must be ${MIN_QUERY}-${MAX_QUERY} characters` }, 400);
  }

  const key = apiKey();
  if (!key) {
    console.error('places-search: GOOGLE_PLACES_API_KEY missing');
    return reply({ error: 'Search unavailable' }, 503);
  }

  const rawCity = (req.nextUrl.searchParams.get('city') ?? '').trim();
  const city = rawCity.length <= MAX_CITY ? rawCity : '';

  const near = ipLocation(req);
  // At most two upstream calls, whatever the path:
  // - a known city the caller did not type: "<q> <city>" first, then plain q;
  // - otherwise the query as typed, then its name part ("NAME" of a pasted
  //   "NAME, street, mz 1 lt 3", which Google matches nothing for).
  const attempts: string[] = [];
  if (shouldAppendCity(q, city)) {
    attempts.push(`${q} ${city}`);
    attempts.push(q);
  } else {
    attempts.push(q);
    const simplified = simplifyQuery(q, city);
    if (simplified && simplified !== q) attempts.push(simplified);
  }

  let results: ReturnType<typeof toResult>[] = [];
  for (let i = 0; i < attempts.length; i++) {
    try {
      results = await searchText(attempts[i], key, near);
    } catch (err) {
      console.error('places-search: upstream error', err instanceof Error ? err.message : err);
      if (i === 0) return reply({ error: 'Search failed' }, 502);
      results = [];
    }
    if (results.length > 0) return reply(results, 200, i === 0 ? {} : { 'X-Places-Retried': '1' });
  }
  return reply([], 200, { 'X-Places-Retried': attempts.length > 1 ? '1' : '0' });
}

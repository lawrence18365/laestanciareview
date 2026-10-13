/**
 * Nearby restaurant competitors via the legacy Places nearbysearch endpoint.
 *
 * Shared by the public audit page (`/audit/[placeId]`) and signup onboarding
 * (`google-onboarding.ts`). Extracted from the audit page unchanged: same
 * endpoint, type=restaurant, 3 km radius, and the same filters (excludes the
 * place itself, places without a rating, and places with < 10 reviews).
 * Results keep Google's order; each caller applies its own sort.
 */

export const NEARBY_RADIUS_M = 3000;

export interface NearbyCompetitor {
  placeId: string;
  name: string;
  rating: number;
  userRatingsTotal: number;
  /** Straight-line distance from the origin (haversine), or null without geometry. */
  distanceM: number | null;
}

export interface CompetitorFetchOptions {
  /** Abort the request (signup uses a total time budget). */
  signal?: AbortSignal;
  /** Next.js fetch cache window in seconds. Omitted = no cache. */
  revalidate?: number;
}

/**
 * Same sanitising as maps-rank: a copied env value once arrived as `"KEY\n"`
 * (quotes plus a literal backslash-n) and every call returned 400 (SQ-159).
 */
export function placesApiKey(): string | null {
  const key = (process.env.GOOGLE_PLACES_API_KEY ?? '')
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\\n$/, '')
    .trim();
  return key || null;
}

/** Great-circle distance in whole meters. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

interface NearbyApiResult {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: { location?: { lat?: number; lng?: number } };
}

export async function getNearbyCompetitors(
  lat: number,
  lng: number,
  excludePlaceId: string,
  options: CompetitorFetchOptions = {},
): Promise<NearbyCompetitor[]> {
  const key = placesApiKey();
  if (!key) return [];
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${NEARBY_RADIUS_M}&type=restaurant&key=${key}`;
  const init: RequestInit & { next?: { revalidate: number } } = options.signal
    ? { signal: options.signal }
    : {};
  if (options.revalidate !== undefined) init.next = { revalidate: options.revalidate };
  else init.cache = 'no-store';
  const res = await fetch(url, init);
  const data = await res.json();
  return ((data.results || []) as NearbyApiResult[])
    .filter(
      (p) =>
        p.place_id !== excludePlaceId &&
        p.rating &&
        (p.user_ratings_total ?? 0) >= 10,
    )
    .map((p) => {
      const pLat = p.geometry?.location?.lat;
      const pLng = p.geometry?.location?.lng;
      return {
        placeId: p.place_id,
        name: p.name,
        rating: p.rating as number,
        userRatingsTotal: p.user_ratings_total as number,
        distanceM:
          typeof pLat === 'number' && typeof pLng === 'number'
            ? haversineMeters({ lat, lng }, { lat: pLat, lng: pLng })
            : null,
      };
    });
}

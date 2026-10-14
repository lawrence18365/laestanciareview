/**
 * Nearby restaurant competitors via the legacy Places nearbysearch endpoint.
 *
 * Shared by the public audit page (`/audit/[placeId]`) and signup onboarding
 * (`google-onboarding.ts`). Extracted from the audit page unchanged: same
 * endpoint, type=restaurant, 3 km radius, and the same filters (excludes the
 * place itself, places without a rating, and places with < 10 reviews).
 * Results keep Google's order; each caller applies its own sort.
 *
 * Onboarding (SQ-214) does not want "the biggest places nearby" (national
 * chains) but comparable local ones: `findComparableCompetitors` below scores
 * candidates by category, review-count range, chain denylist and distance.
 * The audit page does not use it and is unchanged.
 */
import { categoryLabel, isFoodOrDrink, type Competitor } from '@/lib/onboarding-profile';

export const NEARBY_RADIUS_M = 3000;

export interface NearbyCompetitor {
  placeId: string;
  name: string;
  rating: number;
  userRatingsTotal: number;
  /** Straight-line distance from the origin (haversine), or null without geometry. */
  distanceM: number | null;
  /** Google's legacy `types` for the place (empty when absent). */
  types: string[];
}

export interface CompetitorFetchOptions {
  /** Abort the request (signup uses a total time budget). */
  signal?: AbortSignal;
  /** Next.js fetch cache window in seconds. Omitted = no cache. */
  revalidate?: number;
  /** Optional nearbysearch `keyword` (onboarding category search). Omitted = unchanged URL. */
  keyword?: string;
  /**
   * Legacy nearbysearch `type`. Omitted = 'restaurant' (the audit page and food
   * onboarding, unchanged URL). A string overrides it; null sends no `type`.
   */
  placeType?: string | null;
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
  types?: unknown;
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
  const keywordParam = options.keyword ? `&keyword=${encodeURIComponent(options.keyword)}` : '';
  const typeParam =
    options.placeType === undefined
      ? '&type=restaurant'
      : options.placeType
        ? `&type=${encodeURIComponent(options.placeType)}`
        : '';
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${NEARBY_RADIUS_M}${typeParam}${keywordParam}&key=${key}`;
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
        types: Array.isArray(p.types)
          ? p.types.filter((t): t is string => typeof t === 'string')
          : [],
        distanceM:
          typeof pLat === 'number' && typeof pLng === 'number'
            ? haversineMeters({ lat, lng }, { lat: pLat, lng: pLng })
            : null,
      };
    });
}

// ─── Comparable competitors (onboarding / welcome line only) ───

export const TOP_COMPARABLE = 3;

/** Well-known chains whose review counts say nothing about a small local place. */
const CHAIN_NAMES = [
  'Toks',
  'KFC',
  "McDonald's",
  'Burger King',
  "Domino's",
  'Little Caesars',
  'Starbucks',
  'Vips',
  'Sanborns',
  'Subway',
  'Pizza Hut',
  "Carl's Jr",
  "Italianni's",
  'Wings',
  'Sushi Itto',
  'El Portón',
  "Chili's",
  "Applebee's",
];

/** Lowercase, no accents, no apostrophes, other punctuation as single spaces. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CHAIN_KEYS = CHAIN_NAMES.map(normalizeName);

export function isKnownChain(name: string): boolean {
  const padded = ` ${normalizeName(name)} `;
  return CHAIN_KEYS.some((k) => padded.includes(` ${k} `));
}

/** Types every restaurant shares; they say nothing about the cuisine. */
const GENERIC_TYPES = new Set([
  'restaurant',
  'food',
  'point_of_interest',
  'establishment',
  'meal_takeaway',
  'meal_delivery',
  'store',
]);

export interface ComparableOwn {
  /** The restaurant's own Google review count (null when unknown). */
  reviewCount: number | null;
  primaryType: string | null;
  /** Places display name of the primary type, es (e.g. "dentista"); null on legacy rows. */
  primaryTypeLabel?: string | null;
  types: string[];
}

export interface ComparableCandidate extends NearbyCompetitor {
  /** True when the category-filtered (keyword) search also returned this place. */
  keywordMatch?: boolean;
}

/** Tiny counts are floored so the 0.5x-4x window stays meaningful. */
const OWN_COUNT_FLOOR = 20;

function sharesCategory(own: ComparableOwn, c: ComparableCandidate): boolean {
  if (c.keywordMatch) return true;
  const specific = new Set(
    [own.primaryType, ...own.types].filter(
      (t): t is string => typeof t === 'string' && !GENERIC_TYPES.has(t),
    ),
  );
  return c.types.some((t) => specific.has(t));
}

/**
 * Pick the 3 most comparable places. Order of preference: same category, review
 * count within 0.5x-4x of the restaurant's own (floor 20), then the closest.
 * Known chains and anything with over 10x the restaurant's reviews are
 * excluded; if that leaves fewer than 3, the closest non-chain places fill in.
 */
export function selectComparableCompetitors(
  own: ComparableOwn,
  candidates: ComparableCandidate[],
): NearbyCompetitor[] {
  const base = Math.max(own.reviewCount ?? 0, OWN_COUNT_FLOOR);
  const lo = base * 0.5;
  const hi = base * 4;
  const maxCount = base * 10;
  const byDistance = (a: ComparableCandidate, b: ComparableCandidate) =>
    (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
    b.userRatingsTotal - a.userRatingsTotal;

  const nonChain = candidates.filter((c) => !isKnownChain(c.name));
  const qualifying = nonChain.filter((c) => c.userRatingsTotal <= maxCount);
  const rest = nonChain.filter((c) => c.userRatingsTotal > maxCount);

  const rank = (c: ComparableCandidate) =>
    (sharesCategory(own, c) ? 0 : 2) +
    (c.userRatingsTotal >= lo && c.userRatingsTotal <= hi ? 0 : 1);
  const picked = qualifying.sort((a, b) => rank(a) - rank(b) || byDistance(a, b));
  if (picked.length < TOP_COMPARABLE) picked.push(...rest.sort(byDistance));
  return picked.slice(0, TOP_COMPARABLE).map(({ keywordMatch: _keywordMatch, ...c }) => c);
}

/**
 * Onboarding competitor lookup. Food/drink (and unknown) places: the usual
 * nearbysearch plus, for a specific category, one extra search with the
 * category label as keyword (run in parallel; its failure is ignored).
 * Both share the caller's abort signal. Non-food places (a dentist, a
 * laundry) take `findNonFoodCompetitors` and are never searched as restaurants.
 */
export async function findComparableCompetitors(
  lat: number,
  lng: number,
  excludePlaceId: string,
  own: ComparableOwn,
  options: CompetitorFetchOptions = {},
): Promise<Competitor[]> {
  if (!isFoodOrDrink(own)) return findNonFoodCompetitors(lat, lng, excludePlaceId, own, options);
  const keyword = categoryLabel(own.primaryType);
  const [general, byCategory] = await Promise.all([
    getNearbyCompetitors(lat, lng, excludePlaceId, options),
    keyword === categoryLabel(null)
      ? Promise.resolve([] as NearbyCompetitor[])
      : getNearbyCompetitors(lat, lng, excludePlaceId, { ...options, keyword }).catch(
          () => [] as NearbyCompetitor[],
        ),
  ]);
  const matched = new Set(byCategory.map((c) => c.placeId));
  const merged = new Map<string, ComparableCandidate>();
  for (const c of [...general, ...byCategory]) {
    if (!merged.has(c.placeId)) {
      merged.set(c.placeId, { ...c, keywordMatch: matched.has(c.placeId) });
    }
  }
  return selectComparableCompetitors(own, [...merged.values()]).map(toCompetitor);
}

function toCompetitor(c: NearbyCompetitor): Competitor {
  return {
    name: c.name,
    reviewCount: c.userRatingsTotal,
    rating: c.rating,
    distanceM: c.distanceM,
  };
}

/**
 * Same-category search for a non-food place: ONE legacy nearbysearch with no
 * `type=restaurant`. With a category label it is a keyword search ("dentista");
 * without one, the place's own primaryType is the `type`. Nothing usable ->
 * no search. SKU: the same legacy Nearby Search as the food path (about
 * US$0.032 + US$0.005 Atmosphere data = about US$0.037 per signup, one call).
 * Places (New) searchNearby/searchText with rating and review count is the
 * Enterprise tier (about US$0.035), no cheaper, and needs a second parser.
 */
async function findNonFoodCompetitors(
  lat: number,
  lng: number,
  excludePlaceId: string,
  own: ComparableOwn,
  options: CompetitorFetchOptions,
): Promise<Competitor[]> {
  // categoryLabel sees only primaryType (null reads as unknown/food), so skip it with neither.
  const label =
    own.primaryType || own.primaryTypeLabel
      ? categoryLabel(own.primaryType, own.primaryTypeLabel)
      : 'negocio';
  let search: CompetitorFetchOptions;
  if (label !== 'negocio') search = { ...options, placeType: null, keyword: label };
  else if (own.primaryType) search = { ...options, placeType: own.primaryType };
  else return [];
  const found = await getNearbyCompetitors(lat, lng, excludePlaceId, search);
  return selectComparableCompetitors(
    own,
    found.map((c) => ({ ...c, keywordMatch: true })),
  ).map(toCompetitor);
}

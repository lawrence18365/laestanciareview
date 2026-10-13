/**
 * Google data for a brand-new self-serve restaurant (US-14 T2).
 *
 * One Places v1 details call plus one nearby-competitors search, under a
 * single 3 second total budget so signup latency stays bounded. Any failure
 * (no key, HTTP error, timeout, bad payload, competitor search failure)
 * returns all nulls; the caller provisions the restaurant anyway and the
 * daily rating refresh fills the numbers in later.
 *
 * Places SKU tiers (Google price list, approximate; verify before changing):
 *  - Place Details (New) FieldMask `rating,userRatingCount,primaryType,types,
 *    takeout,delivery,dineIn,location,formattedAddress`. The highest tier of
 *    any requested field bills the whole call: takeout/delivery/dineIn are
 *    Enterprise + Atmosphere (about US$25 per 1,000 = US$0.025).
 *    Without those three booleans it would be Enterprise (about US$20/1,000).
 *  - Nearby Search (legacy, type=restaurant): about US$32 per 1,000 =
 *    US$0.032, plus about US$0.005 for Atmosphere data (rating, review count).
 *  Estimated total per signup: roughly US$0.06-0.07, under the ~US$0.10
 *  design-reopen threshold. Self-serve trials sign up a few per day.
 *
 * Logs a short code only. Never logs the key, the URL (it carries the key) or
 * response bodies.
 */
import { getNearbyCompetitors, placesApiKey } from '@/lib/competitors';
import type { Competitor, GoogleProfile } from '@/lib/onboarding-profile';

const PLACES_BASE = 'https://places.googleapis.com/v1';
const FIELD_MASK =
  'rating,userRatingCount,primaryType,types,takeout,delivery,dineIn,location,formattedAddress';
export const ONBOARDING_BUDGET_MS = 3000;
const TOP_COMPETITORS = 3;

export type OnboardingGoogleData = {
  /** Stored as text, like restaurants.google_rating. */
  rating: string | null;
  reviewCount: number | null;
  profile: GoogleProfile | null;
};

const EMPTY: OnboardingGoogleData = { rating: null, reviewCount: null, profile: null };

interface PlaceV1 {
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: unknown;
  takeout?: boolean;
  delivery?: boolean;
  dineIn?: boolean;
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
}

class FetchCode extends Error {}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

async function load(placeId: string, signal: AbortSignal): Promise<OnboardingGoogleData> {
  const key = placesApiKey();
  if (!key) throw new FetchCode('no_key');

  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new FetchCode(`http_${res.status}`);
  const place = (await res.json()) as PlaceV1;

  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const hasLocation = typeof lat === 'number' && typeof lng === 'number';

  let competitors: Competitor[] = [];
  if (hasLocation) {
    const nearby = await getNearbyCompetitors(lat, lng, placeId, { signal });
    competitors = nearby
      .sort((a, b) => b.userRatingsTotal - a.userRatingsTotal)
      .slice(0, TOP_COMPETITORS)
      .map((c) => ({
        name: c.name,
        reviewCount: c.userRatingsTotal,
        rating: c.rating,
        distanceM: c.distanceM,
      }));
  }

  const profile: GoogleProfile = {
    primaryType: typeof place.primaryType === 'string' ? place.primaryType : null,
    types: Array.isArray(place.types)
      ? place.types.filter((t): t is string => typeof t === 'string')
      : [],
    takeout: bool(place.takeout),
    delivery: bool(place.delivery),
    dineIn: bool(place.dineIn),
    lat: hasLocation ? lat : null,
    lng: hasLocation ? lng : null,
    formattedAddress:
      typeof place.formattedAddress === 'string' ? place.formattedAddress : null,
    competitors,
    fetchedAt: new Date().toISOString(),
  };

  return {
    rating: typeof place.rating === 'number' ? place.rating.toString() : null,
    reviewCount:
      typeof place.userRatingCount === 'number' ? Math.round(place.userRatingCount) : null,
    profile,
  };
}

export async function fetchOnboardingGoogleData(
  placeId: string,
): Promise<OnboardingGoogleData> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, ONBOARDING_BUDGET_MS);
  });
  try {
    const result = await Promise.race([load(placeId, controller.signal), timeout]);
    if (result === 'timeout') {
      console.warn('[google-onboarding] code=timeout');
      return { ...EMPTY };
    }
    return result;
  } catch (err) {
    const code = err instanceof FetchCode ? err.message : controller.signal.aborted ? 'timeout' : 'error';
    console.warn(`[google-onboarding] code=${code}`);
    return { ...EMPTY };
  } finally {
    clearTimeout(timer);
  }
}

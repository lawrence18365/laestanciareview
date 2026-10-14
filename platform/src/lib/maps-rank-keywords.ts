import { categoryLabel, parseGoogleProfile } from '@/lib/onboarding-profile';

/** Brand slugs (restaurants.brand) that are steakhouses. */
const STEAK_BRANDS = new Set(['estancia', 'steakcompany']);
const SEAFOOD_BRANDS = new Set(['harbors']);

/**
 * Starting keywords for a restaurant's Maps rank tracker, in Spanish.
 * Empty when the city is unknown, since a keyword without a city is not a local search.
 *
 * Self-serve restaurants (pass `groupKey: null`) get ONE keyword: the Places
 * category noun plus the city ("marisquería Caltzontzin"), or "restaurante
 * {city}" when there is no usable profile. Omitting `groupKey` keeps the
 * group behavior untouched.
 */
export function defaultKeywords(r: {
  city: string | null;
  brand: string | null;
  groupKey?: string | null;
  googleProfile?: unknown;
}): string[] {
  const city = r.city?.trim();
  if (!city) return [];
  if (r.brand && STEAK_BRANDS.has(r.brand)) {
    return [`restaurante de cortes ${city}`, `cortes argentinos ${city}`, `restaurante argentino ${city}`];
  }
  if (r.brand && SEAFOOD_BRANDS.has(r.brand)) {
    return [`mariscos ${city}`, `restaurante de mariscos ${city}`];
  }
  if (r.groupKey === null) {
    const profile = parseGoogleProfile(r.googleProfile);
    return [`${categoryLabel(profile?.primaryType ?? null, profile?.primaryTypeLabel)} ${city}`];
  }
  // Generic "restaurante {city}" ranks nobody useful for a group (SQ-159); founders add keywords by hand.
  return [];
}

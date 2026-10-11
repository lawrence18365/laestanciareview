/** Brand slugs (restaurants.brand) that are steakhouses. */
const STEAK_BRANDS = new Set(['estancia', 'steakcompany']);
const SEAFOOD_BRANDS = new Set(['harbors']);

/**
 * Starting keywords for a restaurant's Maps rank tracker, in Spanish.
 * Empty when the city is unknown, since a keyword without a city is not a local search.
 */
export function defaultKeywords(r: { city: string | null; brand: string | null }): string[] {
  const city = r.city?.trim();
  if (!city) return [];
  if (r.brand && STEAK_BRANDS.has(r.brand)) {
    return [`restaurante de cortes ${city}`, `steakhouse ${city}`, `restaurante ${city}`];
  }
  if (r.brand && SEAFOOD_BRANDS.has(r.brand)) {
    return [`mariscos ${city}`, `restaurante de mariscos ${city}`, `restaurante ${city}`];
  }
  return [`restaurante ${city}`];
}

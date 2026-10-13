/**
 * Chain detection for self-serve signups (US-15 M5).
 *
 * A restaurant that signs up as a single self-serve trial but whose name exists
 * at 3+ Google locations is probably a chain: the founders want to know, because
 * a chain is a Grupo-style sale, not a MX$299 plan.
 *
 * One Places v1 `places:searchText` for the business name in Mexico.
 *
 * Places SKU tier (Google price list, approximate; verify before changing):
 * the FieldMask asks for `displayName` and `formattedAddress`, which are Text
 * Search Pro fields (about US$32 per 1,000 = US$0.032 per signup). `id` alone
 * would be the free IDs-only SKU, but the name is what lets us tell a branch
 * of the same brand from an unrelated place that merely matched the query.
 * Self-serve trials sign up a few per day.
 *
 * Never throws and never logs the key, the URL or response bodies: any failure
 * (no key, HTTP error, timeout, bad payload) returns null and signup carries on.
 */
import { placesApiKey } from '@/lib/competitors';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress';
const PAGE_SIZE = 20;
export const CHAIN_DETECT_BUDGET_MS = 3000;

export type ChainDetection = {
  /** Distinct Google places that look like the same brand (includes the signup's own). */
  count: number;
  samplePlaceIds: string[];
  /** Addresses for the same places, aligned with `samplePlaceIds` where known. */
  sampleAddresses: string[];
};

interface SearchPlace {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
}

/**
 * Lowercase, accent-free, single-spaced brand name with any trailing branch
 * suffix removed: "Tacos El Güero - Centro" and "Tacos El Güero Sucursal
 * Norte" both become "tacos el guero". A hyphen only starts a suffix when it
 * has whitespace on a side, so "Coca-Cola Café" keeps its name.
 */
export function normalizeBrandName(raw: string): string {
  const base = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const brand = base
    .replace(/\s[-–—].*$|[-–—]\s.*$/, '')
    .replace(/\s*\bsucursal\b.*$/, '');
  return brand
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameBrand(candidate: string, wanted: string): boolean {
  return candidate === wanted || candidate.startsWith(`${wanted} `);
}

export async function detectChain(name: string, placeId: string): Promise<ChainDetection | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAIN_DETECT_BUDGET_MS);
  try {
    const wanted = normalizeBrandName(name ?? '');
    if (!wanted) return null;
    const key = placesApiKey();
    if (!key) return null;

    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: name,
        pageSize: PAGE_SIZE,
        languageCode: 'es',
        regionCode: 'MX',
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[chain-detect] code=http_${res.status}`);
      return null;
    }
    const data = (await res.json()) as { places?: unknown };
    if (!Array.isArray(data.places)) return null;

    const found = new Map<string, string>();
    for (const p of data.places as SearchPlace[]) {
      if (!p || typeof p.id !== 'string' || !p.id) continue;
      const text = p.displayName?.text;
      if (typeof text !== 'string' || !sameBrand(normalizeBrandName(text), wanted)) continue;
      found.set(p.id, typeof p.formattedAddress === 'string' ? p.formattedAddress : '');
    }
    // The signup's own place is one of the locations even when the search did
    // not rank it into the first page.
    if (placeId && !found.has(placeId)) found.set(placeId, '');

    return {
      count: found.size,
      samplePlaceIds: [...found.keys()].slice(0, 5),
      sampleAddresses: [...found.values()].filter(Boolean).slice(0, 5),
    };
  } catch {
    console.warn(`[chain-detect] code=${controller.signal.aborted ? 'timeout' : 'error'}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

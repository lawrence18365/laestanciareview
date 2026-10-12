/** Map a restaurant slug to its brand logo path and background style. */

export interface BrandInfo {
  logo: string;
  /** Whether the logo looks best on a dark background. */
  darkBg: boolean;
}

const brands: Record<string, BrandInfo> = {
  estancia: { logo: '/logos/estancia.jpg', darkBg: false },
  harbors: { logo: '/logos/harbors.jpeg', darkBg: true },
  'la-silla': { logo: '/logos/la-silla.jpeg', darkBg: true },
  steakcompany: { logo: '/logos/steak-company-logo.jpeg', darkBg: true },
  real: { logo: '/logos/real.jpeg', darkBg: false },
  regio: { logo: '/logos/regio-norte-cocina-del-norte-logo.jpeg', darkBg: false },
  owner: { logo: '/logos/grupo-estancia.png', darkBg: false },
  regional: { logo: '/logos/grupo-estancia.png', darkBg: false },
};

export function getBrandForSlug(slug: string): BrandInfo {
  for (const [prefix, info] of Object.entries(brands)) {
    if (slug.startsWith(prefix)) return info;
  }
  return { logo: '/logos/ratetap_logo_transparent_background.png', darkBg: false };
}

/**
 * Version tag for a restaurant's uploaded logo.
 *
 * The uploaded image lives in the database and is served by /api/logo/[slug]
 * with a 5-minute cache, so the URL has to change when the image does. The data
 * URL IS the image, so hashing it is enough — no extra column, no clock.
 * (`updatedAt` is accepted only because some callers already have the row.)
 *
 * FNV-1a: 8 hex chars, no dependency, identical on server and client.
 */
function logoVersion(dataUrl: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < dataUrl.length; i++) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Brand for a real restaurant row: its own uploaded logo when it has one,
 * otherwise the hardcoded brand table. Use this anywhere a restaurant row is
 * available; `getBrandForSlug` stays for the owner/regional and quote surfaces
 * that only ever have a slug.
 *
 * An uploaded logo is unknown art, so it gets a white tile (`darkBg: false`)
 * rather than guessing that it needs a dark background.
 */
export function getBrandForRestaurant(r: {
  slug: string;
  logoDataUrl: string | null;
  updatedAt?: Date | null;
}): BrandInfo {
  if (r.logoDataUrl) {
    return { logo: `/api/logo/${r.slug}?v=${logoVersion(r.logoDataUrl)}`, darkBg: false };
  }
  return getBrandForSlug(r.slug);
}

/**
 * Quotes and event leads (/quotes, /leads and their APIs) are La Estancia-only
 * for now: the quote catalog in lib/quote-data.ts is La Estancia's own menu with
 * real prices, and it would otherwise show for every tenant.
 */
export function hasEventsQuotes(slug: string): boolean {
  return getBrandForSlug(slug) === brands.estancia;
}

/**
 * Full, guest-facing restaurant names.
 *
 * The `restaurants.name` column holds short operational labels ("Estancia
 * Leon") that are fine on a dashboard but wrong in a WhatsApp message to a
 * guest — they drop the brand's real name and the Spanish accents. Anything a
 * guest reads should come from here.
 *
 * Confirmed: estancia-leon, from the CEO's own campaign copy.
 * The rest apply the same brand prefix and restore accents; have the CEO
 * confirm before a campaign goes out under a name we assumed.
 */
const guestFacingNames: Record<string, string> = {
  'estancia-leon': 'La Estancia Argentina León',
  'estancia-angelopolis': 'La Estancia Argentina Angelópolis',
  'estancia-juarez': 'La Estancia Argentina Juárez',
  'estancia-queretaro': 'La Estancia Argentina Querétaro',
  'estancia-veracruz': 'La Estancia Argentina Veracruz',
  'estancia-xalapa': 'La Estancia Argentina Xalapa',
  'harbors-angelopolis': "Harbor's Angelópolis",
  'harbors-veracruz': "Harbor's Veracruz",
  'la-silla-huexotitla': 'La Silla Huexotitla',
  'la-silla-juarez': 'La Silla Juárez',
  'steakcompany-queretaro': 'Steak Company Querétaro',
  'regio-norte': 'Regio Norte',
};

/**
 * Guest-facing name for a location. Falls back to the operational name so a
 * newly added restaurant still gets a sensible label rather than a slug.
 */
export function getGuestFacingName(slug: string, fallback: string): string {
  return guestFacingNames[slug] ?? fallback;
}

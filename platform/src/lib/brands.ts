/** Map a restaurant slug to its brand logo path and background style. */

interface BrandInfo {
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

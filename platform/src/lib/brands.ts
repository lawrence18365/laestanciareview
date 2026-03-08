/** Map a restaurant slug to its brand logo path and background style. */

interface BrandInfo {
  logo: string;
  /** Whether the logo looks best on a dark background. */
  darkBg: boolean;
}

const brands: Record<string, BrandInfo> = {
  estancia: { logo: '/logos/estancia.jpg', darkBg: false },
  harbours: { logo: '/logos/harbours.jpeg', darkBg: true },
  'la-silla': { logo: '/logos/la-silla.jpeg', darkBg: true },
  sfera: { logo: '/logos/sfera.jpeg', darkBg: true },
  real: { logo: '/logos/real.jpeg', darkBg: false },
  regio: { logo: '/logos/ratetap.webp', darkBg: false },
};

export function getBrandForSlug(slug: string): BrandInfo {
  for (const [prefix, info] of Object.entries(brands)) {
    if (slug.startsWith(prefix)) return info;
  }
  return { logo: '/logos/ratetap.webp', darkBg: false };
}

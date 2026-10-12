import { describe, it, expect } from 'vitest';
import { getBrandForRestaurant, getBrandForSlug } from '@/lib/brands';

describe('getBrandForSlug', () => {
  it('returns estancia brand for slugs starting with "estancia"', () => {
    const brand = getBrandForSlug('estancia-angelopolis');
    expect(brand.logo).toBe('/logos/estancia.jpg');
    expect(brand.darkBg).toBe(false);
  });

  it('returns harbors brand for slugs starting with "harbors"', () => {
    const brand = getBrandForSlug('harbors-veracruz');
    expect(brand.logo).toBe('/logos/harbors.jpeg');
    expect(brand.darkBg).toBe(true);
  });

  it('returns la-silla brand for slugs starting with "la-silla"', () => {
    const brand = getBrandForSlug('la-silla-huexotitla');
    expect(brand.logo).toBe('/logos/la-silla.jpeg');
    expect(brand.darkBg).toBe(true);
  });

  it('returns steakcompany brand for slugs starting with "steakcompany"', () => {
    const brand = getBrandForSlug('steakcompany-queretaro');
    expect(brand.logo).toBe('/logos/steak-company-logo.jpeg');
    expect(brand.darkBg).toBe(true);
  });

  it('returns owner brand for slug "owner"', () => {
    const brand = getBrandForSlug('owner');
    expect(brand.logo).toBe('/logos/grupo-estancia.png');
    expect(brand.darkBg).toBe(false);
  });

  it('returns default RateTap brand for unknown slugs', () => {
    const brand = getBrandForSlug('unknown-restaurant');
    expect(brand.logo).toBe('/logos/ratetap_logo_transparent_background.png');
    expect(brand.darkBg).toBe(false);
  });
});

describe('getBrandForRestaurant', () => {
  const LOGO_HASH = 'a1b2c3d4';

  it('serves the restaurant own uploaded logo, versioned by its content hash', () => {
    const brand = getBrandForRestaurant({ slug: 'mi-cocina', logoHash: LOGO_HASH });
    expect(brand.logo).toBe(`/api/logo/mi-cocina?v=${LOGO_HASH}`);
    // Unknown art, so it is never assumed to need a dark tile.
    expect(brand.darkBg).toBe(false);
  });

  it('is stable for the same hash and different for another one', () => {
    const first = getBrandForRestaurant({ slug: 'mi-cocina', logoHash: LOGO_HASH });
    const again = getBrandForRestaurant({ slug: 'mi-cocina', logoHash: LOGO_HASH });
    const other = getBrandForRestaurant({ slug: 'mi-cocina', logoHash: 'ffffffff' });
    expect(again.logo).toBe(first.logo);
    expect(other.logo).not.toBe(first.logo);
  });

  it('falls back to the slug brand when there is no uploaded logo', () => {
    for (const slug of ['estancia-leon', 'harbors-veracruz', 'unknown-restaurant']) {
      expect(getBrandForRestaurant({ slug, logoHash: null })).toEqual(getBrandForSlug(slug));
    }
  });
});

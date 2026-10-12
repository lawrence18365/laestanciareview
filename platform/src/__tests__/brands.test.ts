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
  const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('serves the restaurant own uploaded logo, versioned by its content', () => {
    const brand = getBrandForRestaurant({
      slug: 'mi-cocina',
      logoDataUrl: LOGO_DATA_URL,
    });
    expect(brand.logo).toMatch(/^\/api\/logo\/mi-cocina\?v=[0-9a-f]{8}$/);
    // Unknown art, so it is never assumed to need a dark tile.
    expect(brand.darkBg).toBe(false);
  });

  it('is stable for the same image and different for another one', () => {
    const first = getBrandForRestaurant({ slug: 'mi-cocina', logoDataUrl: LOGO_DATA_URL });
    const again = getBrandForRestaurant({ slug: 'mi-cocina', logoDataUrl: LOGO_DATA_URL });
    const other = getBrandForRestaurant({
      slug: 'mi-cocina',
      logoDataUrl: `${LOGO_DATA_URL}A`,
    });
    expect(again.logo).toBe(first.logo);
    expect(other.logo).not.toBe(first.logo);
  });

  it('falls back to the slug brand when there is no uploaded logo', () => {
    for (const slug of ['estancia-leon', 'harbors-veracruz', 'unknown-restaurant']) {
      expect(getBrandForRestaurant({ slug, logoDataUrl: null })).toEqual(getBrandForSlug(slug));
    }
  });
});

import { describe, it, expect } from 'vitest';
import { getBrandForSlug } from '@/lib/brands';

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
    expect(brand.logo).toBe('/logos/steak-company-parrilla-urbana-logo.jpeg');
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

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/script', () => ({ default: () => null }));
// product-events imports the db client, which reads DATABASE_URL at load.
vi.mock('@/db', () => ({ db: {} }));

import GooglePlaceSearch, {
  PlaceSearchStatus,
  PLACE_SEARCH_EMPTY,
  PLACE_SEARCH_HELPER,
} from '@/components/GooglePlaceSearch';
import { PRODUCT_EVENT_NAMES, PUBLIC_EVENT_NAMES } from '@/lib/product-events';

function words(s: string) {
  return s.trim().split(/\s+/).length;
}

describe('GooglePlaceSearch hint', () => {
  it('shows the name-only hint when the search came back empty', () => {
    const html = renderToStaticMarkup(<PlaceSearchStatus status="empty" />);
    expect(html).toContain('No lo encontramos. Escribe solo el nombre de tu negocio.');
    expect(words(PLACE_SEARCH_EMPTY)).toBeLessThanOrEqual(15);
  });

  it('shows "Solo el nombre, sin dirección" under the input before any search', () => {
    expect(PLACE_SEARCH_HELPER).toBe('Solo el nombre, sin dirección');
    const html = renderToStaticMarkup(
      <GooglePlaceSearch value="" onChange={() => {}} onSelect={() => {}} city="León" />,
    );
    expect(html).toContain('Solo el nombre, sin dirección');
    expect(html).not.toContain('No lo encontramos');
  });

  it('shows neither the helper nor the empty hint while loading', () => {
    const html = renderToStaticMarkup(<PlaceSearchStatus status="loading" />);
    expect(html).toContain('Buscando en Google...');
    expect(html).not.toContain('Solo el nombre');
  });
});

describe('place_search_empty event', () => {
  it('is recordable from the anonymous signup page', () => {
    expect(PRODUCT_EVENT_NAMES).toContain('place_search_empty');
    expect(PUBLIC_EVENT_NAMES).toContain('place_search_empty');
  });
});

/**
 * GET /api/logo/[slug] — the restaurant's own logo.
 *
 * Public and unauthenticated: the guest pages, the printed QR sheets and the
 * waiter cards all point straight at it. A restaurant with no logo, or a slug
 * that is not a restaurant, must be a plain 404 so the callers can fall back to
 * the hardcoded brand logo without handling an error state.
 *
 * The image is read with its own single-column query and never rides along with
 * a restaurant row; a versioned URL (`?v=<md5 prefix>`) is cached immutably,
 * an unversioned one keeps the short policy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRestaurantLogoDataUrl: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  getRestaurantLogoDataUrl: mocks.getRestaurantLogoDataUrl,
}));

import { GET } from '@/app/api/logo/[slug]/route';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_SHORT = 'public, max-age=300, stale-while-revalidate=86400';

function get(
  slug: string,
  query = '?v=deadbeef',
): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`https://app.ratetapmx.com/api/logo/${slug}${query}`),
    { params: Promise.resolve({ slug }) },
  ];
}

beforeEach(() => {
  mocks.getRestaurantLogoDataUrl.mockReset();
});

describe('GET /api/logo/[slug]', () => {
  it('returns the decoded bytes and a cacheable PNG response', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(PNG_DATA_URL);

    const res = await GET(...get('mi-cocina'));

    expect(res.status).toBe(200);
    expect(mocks.getRestaurantLogoDataUrl).toHaveBeenCalledWith('mi-cocina');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(CACHE_IMMUTABLE);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG_BYTES));
  });

  it('caches immutably only when the URL is versioned', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(PNG_DATA_URL);

    const versioned = await GET(...get('mi-cocina', '?v=a1b2c3d4'));
    expect(versioned.headers.get('cache-control')).toBe(CACHE_IMMUTABLE);

    // An empty `v` is not a version: it cannot prove the bytes never change.
    const empty = await GET(...get('mi-cocina', '?v='));
    expect(empty.headers.get('cache-control')).toBe(CACHE_SHORT);

    const unversioned = await GET(...get('mi-cocina', ''));
    expect(unversioned.headers.get('cache-control')).toBe(CACHE_SHORT);
    expect(unversioned.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves each accepted format with its own content type', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(
      `data:image/webp;base64,${PNG_BYTES.toString('base64')}`,
    );

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('404s for a restaurant with no logo', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(null);

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(404);
  });

  it('404s for an unknown slug', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(null);

    const res = await GET(...get('no-existe'));
    expect(res.status).toBe(404);
  });

  it('404s on a stored value that is not an image data URL', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue('data:text/html;base64,PHNjcmlwdD4=');

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(404);
  });
});

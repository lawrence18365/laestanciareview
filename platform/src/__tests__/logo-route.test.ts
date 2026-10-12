/**
 * GET /api/logo/[slug] — the restaurant's own logo.
 *
 * Public and unauthenticated: the guest pages, the printed QR sheets and the
 * waiter cards all point straight at it. A restaurant with no logo, or a slug
 * that is not a restaurant, must be a plain 404 so the callers can fall back to
 * the hardcoded brand logo without handling an error state.
 *
 * The image is read with its own single-column query and never rides along with
 * a restaurant row; a URL whose `v` matches the served image's md5 prefix is
 * cached immutably, a stale/missing `v` keeps the short, revalidating policy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

/** The same tag the queries compute: `substr(md5(logo_data_url), 1, 8)`. */
function versionOf(dataUrl: string): string {
  return createHash('md5').update(dataUrl, 'utf8').digest('hex').slice(0, 8);
}

function get(
  slug: string,
  query = '',
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

    const res = await GET(...get('mi-cocina', `?v=${versionOf(PNG_DATA_URL)}`));

    expect(res.status).toBe(200);
    expect(mocks.getRestaurantLogoDataUrl).toHaveBeenCalledWith('mi-cocina');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(CACHE_IMMUTABLE);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG_BYTES));
  });

  it('caches immutably only for the tag that matches the served bytes', async () => {
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(PNG_DATA_URL);

    const matching = await GET(...get('mi-cocina', `?v=${versionOf(PNG_DATA_URL)}`));
    expect(matching.headers.get('cache-control')).toBe(CACHE_IMMUTABLE);

    // A stale tag (the version of a PREVIOUS image, or any other value) must
    // not pin these bytes for a year: the short policy revalidates instead.
    const stale = await GET(...get('mi-cocina', '?v=deadbeef'));
    expect(stale.headers.get('cache-control')).toBe(CACHE_SHORT);
    expect(stale.headers.get('x-content-type-options')).toBe('nosniff');

    // An empty `v` is not a version: it cannot prove the bytes never change.
    const empty = await GET(...get('mi-cocina', '?v='));
    expect(empty.headers.get('cache-control')).toBe(CACHE_SHORT);

    const unversioned = await GET(...get('mi-cocina', ''));
    expect(unversioned.headers.get('cache-control')).toBe(CACHE_SHORT);
    expect(unversioned.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects the tag of a replaced logo', async () => {
    // Same slug, new image: the URL the owner had open still carries the OLD
    // version tag, and it must revalidate rather than serve a year of stale art.
    const oldTag = versionOf(`data:image/png;base64,${Buffer.from('old').toString('base64')}`);
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(PNG_DATA_URL);

    const res = await GET(...get('mi-cocina', `?v=${oldTag}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_SHORT);
  });

  it('serves each accepted format with its own content type', async () => {
    const webp = `data:image/webp;base64,${PNG_BYTES.toString('base64')}`;
    mocks.getRestaurantLogoDataUrl.mockResolvedValue(webp);

    const res = await GET(...get('mi-cocina', `?v=${versionOf(webp)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe(CACHE_IMMUTABLE);
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

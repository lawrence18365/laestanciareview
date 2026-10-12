/**
 * GET /api/logo/[slug] — the restaurant's own logo.
 *
 * Public and unauthenticated: the guest pages, the printed QR sheets and the
 * waiter cards all point straight at it. A restaurant with no logo, or a slug
 * that is not a restaurant, must be a plain 404 so the callers can fall back to
 * the hardcoded brand logo without handling an error state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRestaurantBySlug: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({ getRestaurantBySlug: mocks.getRestaurantBySlug }));

import { GET } from '@/app/api/logo/[slug]/route';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

function get(slug: string): [NextRequest, { params: Promise<{ slug: string }> }] {
  return [
    new NextRequest(`https://app.ratetapmx.com/api/logo/${slug}?v=deadbeef`),
    { params: Promise.resolve({ slug }) },
  ];
}

beforeEach(() => {
  mocks.getRestaurantBySlug.mockReset();
});

describe('GET /api/logo/[slug]', () => {
  it('returns the decoded bytes and a cacheable PNG response', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({ slug: 'mi-cocina', logoDataUrl: PNG_DATA_URL });

    const res = await GET(...get('mi-cocina'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(PNG_BYTES));
  });

  it('serves each accepted format with its own content type', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({
      slug: 'mi-cocina',
      logoDataUrl: `data:image/webp;base64,${PNG_BYTES.toString('base64')}`,
    });

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('404s for a restaurant with no logo', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({ slug: 'mi-cocina', logoDataUrl: null });

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(404);
  });

  it('404s for an unknown slug', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue(null);

    const res = await GET(...get('no-existe'));
    expect(res.status).toBe(404);
  });

  it('404s on a stored value that is not an image data URL', async () => {
    mocks.getRestaurantBySlug.mockResolvedValue({
      slug: 'mi-cocina',
      logoDataUrl: 'data:text/html;base64,PHNjcmlwdD4=',
    });

    const res = await GET(...get('mi-cocina'));
    expect(res.status).toBe(404);
  });
});

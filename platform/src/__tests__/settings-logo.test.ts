/**
 * PATCH /api/auth/settings — logo upload acceptance, and the Google Place ID
 * that makes the guest "Google" option available.
 *
 * The logo is a data URL (≤ 280 KB) validated here; /api/logo/[slug] serves it
 * back. Only the two rules that matter for the invariant "a stored logo is a
 * real, small image" are exercised: the format allow-list and the size cap.
 *
 * The response never carries the data URL: only the versioned URL, built from
 * the `logoHash` the route reads with its own single-column query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updatedValues: [] as Array<Record<string, unknown>>,
  returning: [] as Array<Record<string, unknown>>,
  /** What `getRestaurantLogoHash` reports (the md5 prefix of the stored logo). */
  logoHash: null as string | null,
  getRestaurantBySlug: vi.fn(),
  getRestaurantLogoHash: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        mocks.updatedValues.push(values);
        return { where: () => ({ returning: async () => [...mocks.returning] }) };
      },
    })),
  },
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'mi-cocina', role: 'gm' })),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: mocks.getRestaurantBySlug,
  getRestaurantLogoHash: mocks.getRestaurantLogoHash,
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/lib/google-places', () => ({ refreshGoogleRating: vi.fn(async () => false) }));
vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
  verifyPassword: vi.fn(async () => true),
}));

import { PATCH } from '@/app/api/auth/settings/route';
import { derivedGoogleReviewUrl } from '@/lib/google-review';

const RESTAURANT = {
  id: 7,
  slug: 'mi-cocina',
  name: 'Mi Cocina',
  googleReviewUrl: null,
  googlePlaceId: null,
  logoHash: null,
  adminPasswordHash: null,
};

const SMALL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const LOGO_HASH = 'a1b2c3d4';

function patch(body: Record<string, unknown>): Request {
  return new Request('https://app.ratetapmx.com/api/auth/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.updatedValues = [];
  mocks.returning = [{ ...RESTAURANT }];
  mocks.logoHash = null;
  mocks.getRestaurantBySlug.mockReset();
  mocks.getRestaurantBySlug.mockResolvedValue({ ...RESTAURANT });
  mocks.getRestaurantLogoHash.mockReset();
  mocks.getRestaurantLogoHash.mockImplementation(async () => mocks.logoHash);
});

describe('PATCH /api/auth/settings — logo', () => {
  it('rejects a data URL that is not a PNG/JPEG/WebP image', async () => {
    const res = await PATCH(patch({ logoDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }));
    expect(res.status).toBe(400);
    expect(mocks.updatedValues).toHaveLength(0);
  });

  it('rejects an oversize logo even when the format is right', async () => {
    const oversize = `data:image/png;base64,${'A'.repeat(300_000)}`;
    const res = await PATCH(patch({ logoDataUrl: oversize }));
    expect(res.status).toBe(400);
    expect(mocks.updatedValues).toHaveLength(0);
  });

  it('accepts a small PNG and returns the served logo URL, not the data URL', async () => {
    mocks.logoHash = LOGO_HASH;
    const res = await PATCH(patch({ logoDataUrl: SMALL_PNG }));
    expect(res.status).toBe(200);

    expect(mocks.updatedValues[0].logoDataUrl).toBe(SMALL_PNG);
    // The version tag comes from Postgres (md5 of the stored data URL), read
    // after the write with a dedicated single-column query.
    expect(mocks.getRestaurantLogoHash).toHaveBeenCalledWith(7);

    const body = (await res.json()) as { logoUrl: string | null };
    expect(body.logoUrl).toBe(`/api/logo/mi-cocina?v=${LOGO_HASH}`);
    expect(JSON.stringify(body)).not.toContain('base64');
  });

  it('accepts null to remove the logo', async () => {
    mocks.logoHash = null;
    const res = await PATCH(patch({ logoDataUrl: null }));
    expect(res.status).toBe(200);

    expect(mocks.updatedValues[0].logoDataUrl).toBeNull();
    const body = (await res.json()) as { logoUrl: string | null };
    expect(body.logoUrl).toBeNull();
  });
});

describe('PATCH /api/auth/settings — Google profile', () => {
  it('derives the review URL from a Place ID when the restaurant has none', async () => {
    mocks.returning = [{ ...RESTAURANT, googlePlaceId: 'ChIJabc', googleReviewUrl: derivedGoogleReviewUrl('ChIJabc') }];
    const res = await PATCH(patch({ googlePlaceId: 'ChIJabc' }));
    expect(res.status).toBe(200);

    expect(mocks.updatedValues[0].googlePlaceId).toBe('ChIJabc');
    expect(mocks.updatedValues[0].googleReviewUrl).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJabc',
    );
  });
});

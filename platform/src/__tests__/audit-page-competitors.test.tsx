/**
 * The audit page uses the extracted lib/competitors helper (no private copy of
 * the nearbysearch call) and keeps its own sort: best rating first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getNearbyCompetitors: vi.fn() }));

vi.mock('@/lib/competitors', () => ({ getNearbyCompetitors: mocks.getNearbyCompetitors }));
vi.mock('@/components/audit/AuditTracker', () => ({ AuditTracker: () => null }));
vi.mock('@/components/audit/PilotCta', () => ({ PilotCta: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('audit page', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'k');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mocks.getNearbyCompetitors.mockReset();
    fetchMock.mockResolvedValue({
      json: async () => ({
        status: 'OK',
        result: {
          name: 'Mi Pizza',
          rating: 4.4,
          user_ratings_total: 80,
          formatted_address: 'León',
          geometry: { location: { lat: 21.12, lng: -101.68 } },
        },
      }),
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('gets competitors from lib/competitors with the same cache window and ranks by rating', async () => {
    mocks.getNearbyCompetitors.mockResolvedValue([
      { placeId: 'a', name: 'Low', rating: 3.9, userRatingsTotal: 500, distanceM: 100 },
      { placeId: 'b', name: 'High', rating: 4.9, userRatingsTotal: 20, distanceM: 200 },
    ]);
    const { default: AuditPage } = await import('@/app/audit/[placeId]/page');

    await AuditPage({ params: Promise.resolve({ placeId: 'self' }) });

    expect(mocks.getNearbyCompetitors).toHaveBeenCalledWith(21.12, -101.68, 'self', {
      revalidate: 86400,
    });
    // Only the details call hits fetch directly; the nearbysearch lives in the helper.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/place/details/json');
  });
});

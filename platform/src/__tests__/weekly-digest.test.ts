import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRestaurantsWithEmail: vi.fn(),
  getOwnerAccounts: vi.fn(),
  getLastWeekStats: vi.fn(),
  getWeekBeforeLastStats: vi.fn(),
  getLastWeekLeaderboard: vi.fn(),
  getNewFeedbackCount: vi.fn(),
  getOverviewStats: vi.fn(),
  getGoogleRatingTrend: vi.fn(),
  sendWeeklyDigest: vi.fn(),
  sendOwnerDigest: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  getRestaurantsWithEmail: mocks.getRestaurantsWithEmail,
  getOwnerAccounts: mocks.getOwnerAccounts,
  getLastWeekStats: mocks.getLastWeekStats,
  getWeekBeforeLastStats: mocks.getWeekBeforeLastStats,
  getLastWeekLeaderboard: mocks.getLastWeekLeaderboard,
  getNewFeedbackCount: mocks.getNewFeedbackCount,
  getOverviewStats: mocks.getOverviewStats,
}));

vi.mock('@/lib/google-places', () => ({
  getGoogleRatingTrend: mocks.getGoogleRatingTrend,
}));

vi.mock('@/lib/email', () => ({
  sendWeeklyDigest: mocks.sendWeeklyDigest,
  sendOwnerDigest: mocks.sendOwnerDigest,
}));

import { GET } from '@/app/api/cron/weekly-digest/route';

const weekStats = { totalReviews: 1, avgRating: 4, googleSends: 1, intercepted: 0 };

describe('weekly digest skippedNoEmail reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getRestaurantsWithEmail.mockResolvedValue([
      { id: 1, slug: 'gm-no-email', name: 'Sin Correo', managerEmail: null, isOwner: false, googleThreshold: 4, googlePlaceId: null },
      { id: 2, slug: 'gm-ok', name: 'Con Correo', managerEmail: 'gm@example.com', isOwner: false, googleThreshold: 4, googlePlaceId: null },
    ]);
    mocks.getOwnerAccounts.mockResolvedValue([
      { id: 3, slug: 'owner-no-email', name: 'Dueño Sin Correo', managerEmail: null, isOwner: true },
      { id: 4, slug: 'owner-ok', name: 'Dueño OK', managerEmail: 'owner@example.com', isOwner: true },
    ]);
    mocks.getLastWeekStats.mockResolvedValue(weekStats);
    mocks.getWeekBeforeLastStats.mockResolvedValue(weekStats);
    mocks.getLastWeekLeaderboard.mockResolvedValue([]);
    mocks.getNewFeedbackCount.mockResolvedValue(0);
    mocks.getOverviewStats.mockResolvedValue([]);
    mocks.getGoogleRatingTrend.mockResolvedValue(null);
    mocks.sendWeeklyDigest.mockResolvedValue({ success: true });
    mocks.sendOwnerDigest.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.restoreAllMocks();
  });

  it('lists GM and owner slugs skipped for missing email in the JSON response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await GET(new NextRequest(
      'http://localhost/api/cron/weekly-digest',
      { headers: { authorization: 'Bearer test-cron-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.gm.skippedNoEmail).toContain('gm-no-email');
    expect(body.gm.sent).toBe(1);
    expect(body.owner.skippedNoEmail).toContain('owner-no-email');
    expect(body.owner.sent).toBe(1);

    expect(warn).toHaveBeenCalledWith('[digest] no email for gm-no-email');
    expect(warn).toHaveBeenCalledWith('[digest] no email for owner-no-email');
    expect(mocks.sendWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerDigest).toHaveBeenCalledTimes(1);
  });
});

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
  getStaffAnomalies: vi.fn(),
  getOperationalRestaurants: vi.fn(),
  getRegionalAccounts: vi.fn(),
  getGoogleRatingTrend: vi.fn(),
  sendWeeklyDigest: vi.fn(),
  sendOwnerDigest: vi.fn(),
  sendPushToRestaurant: vi.fn(),
  getComplaintSlaStats: vi.fn(),
  getOverdueComplaintPreviews: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  getRestaurantsWithEmail: mocks.getRestaurantsWithEmail,
  getOwnerAccounts: mocks.getOwnerAccounts,
  getLastWeekStats: mocks.getLastWeekStats,
  getWeekBeforeLastStats: mocks.getWeekBeforeLastStats,
  getLastWeekLeaderboard: mocks.getLastWeekLeaderboard,
  getNewFeedbackCount: mocks.getNewFeedbackCount,
  getOverviewStats: mocks.getOverviewStats,
  getOperationalRestaurants: mocks.getOperationalRestaurants,
  getRegionalAccounts: mocks.getRegionalAccounts,
}));

vi.mock('@/lib/anomalies', () => ({
  getStaffAnomalies: mocks.getStaffAnomalies,
  formatStaffAnomaly: (anomaly: {
    staffName: string;
    lastWeekCount: number;
    baselineWeekly: number;
    dropPct: number;
  }) => `${anomaly.staffName} recibió ${anomaly.lastWeekCount} respuestas esta semana vs ${Math.round(anomaly.baselineWeekly)} normalmente (-${Math.round(anomaly.dropPct * 100)}%).`,
}));

vi.mock('@/lib/google-places', () => ({
  getGoogleRatingTrend: mocks.getGoogleRatingTrend,
}));

vi.mock('@/lib/email', () => ({
  sendWeeklyDigest: mocks.sendWeeklyDigest,
  sendOwnerDigest: mocks.sendOwnerDigest,
}));

vi.mock('@/lib/push', () => ({
  sendPushToRestaurant: mocks.sendPushToRestaurant,
}));

vi.mock('@/lib/complaint-sla', () => ({
  getComplaintSlaStats: mocks.getComplaintSlaStats,
  getOverdueComplaintPreviews: mocks.getOverdueComplaintPreviews,
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
    mocks.getOperationalRestaurants.mockResolvedValue([
      { id: 1, name: 'Sin Correo', region: 'centro' },
      { id: 2, name: 'Con Correo', region: 'centro' },
    ]);
    mocks.getRegionalAccounts.mockResolvedValue([]);
    mocks.getStaffAnomalies.mockResolvedValue([]);
    mocks.getLastWeekStats.mockResolvedValue(weekStats);
    mocks.getWeekBeforeLastStats.mockResolvedValue(weekStats);
    mocks.getLastWeekLeaderboard.mockResolvedValue([]);
    mocks.getNewFeedbackCount.mockResolvedValue(0);
    mocks.getOverviewStats.mockResolvedValue([]);
    mocks.getGoogleRatingTrend.mockResolvedValue(null);
    mocks.sendWeeklyDigest.mockResolvedValue({ success: true });
    mocks.sendOwnerDigest.mockResolvedValue({ success: true });
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 0, sent: 0, failed: 0 });
    mocks.getComplaintSlaStats.mockResolvedValue({
      received: 0,
      reviewedWithin2h: 0,
      resolvedWithin24h: 0,
      overdueOpen: 0,
      avgHoursToReview: null,
      avgHoursToResolve: null,
    });
    mocks.getOverdueComplaintPreviews.mockResolvedValue([]);
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

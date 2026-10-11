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
  sendOwnerBriefing: vi.fn(() => Promise.resolve({ success: true })),
  sendRegionalBriefing: vi.fn(() => Promise.resolve({ success: true })),
  sendPushToRestaurant: vi.fn(),
  getComplaintSlaStats: vi.fn(),
  getOverdueComplaintPreviews: vi.fn(),
  getMapsRankSummary: vi.fn(),
  getWeeklySignals: vi.fn(),
}));

vi.mock('@/lib/maps-rank', () => ({
  getMapsRankSummary: mocks.getMapsRankSummary,
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
  getGoogleRatingTrendBatch: async () => ({}),
}));

vi.mock('@/lib/email', () => ({
  sendWeeklyDigest: mocks.sendWeeklyDigest,
  sendOwnerDigest: mocks.sendOwnerDigest,
  sendOwnerBriefing: mocks.sendOwnerBriefing,
  sendRegionalBriefing: mocks.sendRegionalBriefing,
}));

vi.mock('@/lib/push', () => ({
  sendPushToRestaurant: mocks.sendPushToRestaurant,
}));

vi.mock('@/lib/complaint-sla', () => ({
  getComplaintSlaStats: mocks.getComplaintSlaStats,
  getOverdueComplaintPreviews: mocks.getOverdueComplaintPreviews,
}));

vi.mock('@/lib/weekly-signal', () => ({
  TELEMETRY_START: new Date('2026-08-21T00:00:00.000Z'),
  lastCompleteWeekStart: () => new Date('2026-08-31T00:00:00.000Z'),
  getWeeklySignals: mocks.getWeeklySignals,
  getGuestSignals: async () => new Map(),
  getServiceSignals: async () => new Map(),
  getUpcomingBirthdays: async () => [],
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
    mocks.getWeeklySignals.mockResolvedValue([]);
    mocks.getMapsRankSummary.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.MAPS_RANK_EMAIL_ENABLED;
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
    expect(mocks.sendOwnerBriefing).toHaveBeenCalledTimes(1);
    expect(mocks.sendOwnerBriefing).toHaveBeenCalledWith(expect.objectContaining({ groupName: 'Dueño OK' }));
  });
});

const signal = (restaurantId: number, name: string) => ({
  restaurantId,
  name,
  region: 'centro',
  scansThisWeek: 1,
  scansLastWeek: 1,
  staffAskingThisWeek: 0,
  staffAskingLastWeek: 0,
  gmActiveDays: 3,
  signal: { summary: 'Activo', signal: 'mixed', actionable: false },
});

const summary = {
  keyword: 'restaurante centro',
  measured: 9,
  top3: 2,
  top10: 4,
  found: 6,
  bestRank: 1,
  prevTop3: null,
  runDate: '2026-10-05',
  prevRunDate: null,
};

const get = () => GET(new NextRequest(
  'http://localhost/api/cron/weekly-digest',
  { headers: { authorization: 'Bearer test-cron-secret' } },
));

describe('weekly digest maps rank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getRestaurantsWithEmail.mockResolvedValue([]);
    mocks.getOwnerAccounts.mockResolvedValue([
      { id: 4, slug: 'owner-ok', name: 'Dueño OK', managerEmail: 'owner@example.com', isOwner: true },
    ]);
    mocks.getOperationalRestaurants.mockResolvedValue([]);
    mocks.getRegionalAccounts.mockResolvedValue([]);
    mocks.getStaffAnomalies.mockResolvedValue([]);
    mocks.getLastWeekStats.mockResolvedValue(weekStats);
    mocks.getWeekBeforeLastStats.mockResolvedValue(weekStats);
    mocks.getLastWeekLeaderboard.mockResolvedValue([]);
    mocks.getNewFeedbackCount.mockResolvedValue(0);
    mocks.getOverviewStats.mockResolvedValue([]);
    mocks.getGoogleRatingTrend.mockResolvedValue(null);
    mocks.sendOwnerBriefing.mockResolvedValue({ success: true });
    mocks.getComplaintSlaStats.mockResolvedValue({
      received: 0, reviewedWithin2h: 0, resolvedWithin24h: 0, overdueOpen: 0, avgHoursToReview: null, avgHoursToResolve: null,
    });
    mocks.getOverdueComplaintPreviews.mockResolvedValue([]);
    mocks.getWeeklySignals.mockResolvedValue([signal(1, 'Centro'), signal(2, 'Norte')]);
    mocks.getMapsRankSummary.mockResolvedValue([summary]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.MAPS_RANK_EMAIL_ENABLED;
    vi.restoreAllMocks();
  });

  it('does not call getMapsRankSummary when the flag is off', async () => {
    await get();

    expect(mocks.getMapsRankSummary).not.toHaveBeenCalled();
    expect(mocks.sendOwnerBriefing).toHaveBeenCalledWith(expect.not.objectContaining({ mapsRank: expect.anything() }));
  });

  it('passes per-location summaries to the owner briefing when the flag is on', async () => {
    process.env.MAPS_RANK_EMAIL_ENABLED = 'true';

    await get();

    expect(mocks.getMapsRankSummary).toHaveBeenCalledWith(1);
    expect(mocks.getMapsRankSummary).toHaveBeenCalledWith(2);
    expect(mocks.sendOwnerBriefing).toHaveBeenCalledWith(expect.objectContaining({
      mapsRank: [
        { locationName: 'Centro', summaries: [summary] },
        { locationName: 'Norte', summaries: [summary] },
      ],
    }));
  });

  it('skips a location whose lookup throws and still sends the briefing', async () => {
    process.env.MAPS_RANK_EMAIL_ENABLED = 'true';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getMapsRankSummary.mockImplementation(async (id: number) => {
      if (id === 1) throw new Error('places down');
      return [summary];
    });

    const response = await get();
    const body = await response.json();

    expect(body.owner.sent).toBe(1);
    expect(mocks.sendOwnerBriefing).toHaveBeenCalledWith(expect.objectContaining({
      mapsRank: [{ locationName: 'Norte', summaries: [summary] }],
    }));
  });
});

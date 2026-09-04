import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  useEmailMocks: false,
  sendMail: vi.fn(),
  sendWeeklyDigest: vi.fn(),
  sendOwnerDigest: vi.fn(),
  sendPushToRestaurant: vi.fn(),
  getRestaurantsWithEmail: vi.fn(),
  getOperationalRestaurants: vi.fn(),
  getOwnerAccounts: vi.fn(),
  getRegionalAccounts: vi.fn(),
  getLastWeekStats: vi.fn(),
  getWeekBeforeLastStats: vi.fn(),
  getLastWeekLeaderboard: vi.fn(),
  getNewFeedbackCount: vi.fn(),
  getOverviewStats: vi.fn(),
  getQuietStaff: vi.fn(),
  getGoogleRatingTrend: vi.fn(),
  getComplaintSlaStats: vi.fn(),
  getOverdueComplaintPreviews: vi.fn(),
}));

vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return {
    ...actual,
    sendWeeklyDigest: (...args: Parameters<typeof actual.sendWeeklyDigest>) => (
      mocks.useEmailMocks
        ? mocks.sendWeeklyDigest(...args)
        : actual.sendWeeklyDigest(...args)
    ),
    sendOwnerDigest: (...args: Parameters<typeof actual.sendOwnerDigest>) => (
      mocks.useEmailMocks
        ? mocks.sendOwnerDigest(...args)
        : actual.sendOwnerDigest(...args)
    ),
  };
});

vi.mock('@/lib/queries', () => ({
  getRestaurantsWithEmail: mocks.getRestaurantsWithEmail,
  getOperationalRestaurants: mocks.getOperationalRestaurants,
  getOwnerAccounts: mocks.getOwnerAccounts,
  getRegionalAccounts: mocks.getRegionalAccounts,
  getLastWeekStats: mocks.getLastWeekStats,
  getWeekBeforeLastStats: mocks.getWeekBeforeLastStats,
  getLastWeekLeaderboard: mocks.getLastWeekLeaderboard,
  getNewFeedbackCount: mocks.getNewFeedbackCount,
  getOverviewStats: mocks.getOverviewStats,
  getQuietStaff: mocks.getQuietStaff,
}));

vi.mock('@/lib/google-places', () => ({
  getGoogleRatingTrend: mocks.getGoogleRatingTrend,
}));

vi.mock('@/lib/push', () => ({
  sendPushToRestaurant: mocks.sendPushToRestaurant,
}));

vi.mock('@/lib/complaint-sla', () => ({
  getComplaintSlaStats: mocks.getComplaintSlaStats,
  getOverdueComplaintPreviews: mocks.getOverdueComplaintPreviews,
}));

vi.mock('@/lib/mexico-tz', () => ({
  isoWeekMexico: () => '2026-W36',
}));

import { sendOwnerDigest, sendWeeklyDigest } from '@/lib/email';
import { GET } from '@/app/api/cron/weekly-digest/route';

const mailSuccess = {
  success: true,
  skipped: false,
  messageId: 'message-1',
  response: null,
  error: null,
};

const weekStats = {
  totalReviews: 20,
  avgRating: 4.8,
  googleSends: 12,
  intercepted: 1,
};

const quietAna = {
  staffId: 11,
  staffName: 'Ana',
  staffCode: 'ANA',
  priorWeeklyAvg: 12,
  lastWeekCount: 0,
};

function visibleText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:])/g, '$1')
    .trim();
}

describe('quiet staff weekly digest rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useEmailMocks = false;
    mocks.sendMail.mockResolvedValue(mailSuccess);
  });

  it('renders the quiet-staff section with compliant wording', async () => {
    await sendWeeklyDigest({
      to: 'gm@example.com',
      restaurantName: 'Centro',
      lastWeek: weekStats,
      weekBefore: weekStats,
      unresolvedCount: 0,
      topPerformers: [],
      quietStaff: [quietAna],
      dashboardUrl: 'https://example.com/dashboard',
    });

    const html = mocks.sendMail.mock.calls[0][0].html as string;
    const text = visibleText(html);
    expect(text).toContain('Dejaron de pedir opiniones esta semana');
    expect(text).toContain('Ana, promedio anterior 12/sem a 0 esta semana');
    expect(text).toContain('Pregúntale qué pasó y entrégale tarjeta nueva si la perdió.');
    expect(text).toContain('Top meseros por experiencia del cliente');
    expect(text).not.toContain('\u2014');
    expect(text).not.toMatch(/\b(meta|objetivo|cuota)\b/i);
  });

  it('omits the quiet-staff section when the list is empty', async () => {
    await sendWeeklyDigest({
      to: 'gm@example.com',
      restaurantName: 'Centro',
      lastWeek: weekStats,
      weekBefore: weekStats,
      unresolvedCount: 0,
      topPerformers: [],
      quietStaff: [],
      dashboardUrl: 'https://example.com/dashboard',
    });

    const html = mocks.sendMail.mock.calls[0][0].html as string;
    expect(visibleText(html)).not.toContain('Dejaron de pedir opiniones esta semana');
  });

  it('renders compact top and quiet staff lines in the owner digest', async () => {
    await sendOwnerDigest({
      to: 'owner@example.com',
      dashboardUrl: 'https://example.com/overview',
      locations: [{
        name: 'Centro',
        reviews: 41,
        avgRating: 4.9,
        googleSends: 20,
        intercepted: 0,
        unresolved: 0,
        ratingChange: null,
        currentRating: null,
        topStaff: [{ name: 'Ana', avgRating: 4.9, reviewCount: 41 }],
        quietStaff: [quietAna],
        complaints: {
          received: 3,
          resolvedWithin24h: 2,
          overdueOpen: 1,
          overdue: [{ rating: 1, hoursOpen: 30, feedbackPreview: 'Servicio muy lento' }],
        },
      }],
    });

    const html = mocks.sendMail.mock.calls[0][0].html as string;
    const text = visibleText(html);
    expect(text).toContain('Top: Ana (4.9★, 41)');
    expect(text).toContain('Dejaron de pedir: Ana (12 a 0)');
    expect(text).toContain('Quejas: 3 recibidas, 67% atendidas en menos de 24 h, 1 vencidas');
    expect(text).toContain('1 estrella, 30 h abierta: &ldquo;Servicio muy lento&rdquo;');
    expect(text).toContain('Opiniones capturadas');
    expect(text).not.toContain('reseñas por mesero');
  });
});

describe('weekly digest quiet push wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useEmailMocks = true;
    process.env.CRON_SECRET = 'quiet-test-secret';

    const north = {
      id: 1,
      slug: 'norte',
      name: 'Norte',
      managerEmail: 'norte@example.com',
      isOwner: false,
      isRegional: false,
      region: 'north',
      googleThreshold: 4,
      googlePlaceId: null,
    };
    const south = {
      id: 2,
      slug: 'sur',
      name: 'Sur',
      managerEmail: 'sur@example.com',
      isOwner: false,
      isRegional: false,
      region: 'south',
      googleThreshold: 4,
      googlePlaceId: null,
    };
    mocks.getRestaurantsWithEmail.mockResolvedValue([north, south]);
    mocks.getOperationalRestaurants.mockResolvedValue([north, south]);
    mocks.getOwnerAccounts.mockResolvedValue([{
      id: 90,
      slug: 'owner',
      name: 'Owner',
      managerEmail: 'owner@example.com',
      isOwner: true,
      isRegional: false,
      region: null,
    }]);
    mocks.getRegionalAccounts.mockResolvedValue([{
      id: 91,
      slug: 'regional-north',
      name: 'Regional North',
      managerEmail: null,
      isOwner: false,
      isRegional: true,
      region: 'north',
    }]);
    mocks.getOverviewStats.mockResolvedValue([
      { restaurantId: 1, restaurantName: 'Norte', weeklyReviews: 20, weeklyAvg: 4.8, weeklyGoogle: 12, weeklyIntercepted: 1 },
      { restaurantId: 2, restaurantName: 'Sur', weeklyReviews: 10, weeklyAvg: 4.5, weeklyGoogle: 6, weeklyIntercepted: 0 },
    ]);
    mocks.getQuietStaff.mockImplementation(async (restaurantId: number) => (
      restaurantId === 1
        ? [quietAna]
        : [
          { staffId: 21, staffName: 'Beto', staffCode: 'BETO', priorWeeklyAvg: 8, lastWeekCount: 1 },
          { staffId: 22, staffName: 'Carla', staffCode: 'CARLA', priorWeeklyAvg: 7, lastWeekCount: 0 },
        ]
    ));
    mocks.getLastWeekStats.mockResolvedValue(weekStats);
    mocks.getWeekBeforeLastStats.mockResolvedValue(weekStats);
    mocks.getLastWeekLeaderboard.mockImplementation(async (_restaurantId: number, limit: number) => (
      limit === 3
        ? [{ staffName: 'Luz', staffCode: 'LUZ', avgRating: 4.9, reviewCount: 41 }]
        : []
    ));
    mocks.getNewFeedbackCount.mockResolvedValue(0);
    mocks.getGoogleRatingTrend.mockResolvedValue(null);
    mocks.getComplaintSlaStats.mockResolvedValue({
      received: 0,
      reviewedWithin2h: 0,
      resolvedWithin24h: 0,
      overdueOpen: 0,
      avgHoursToReview: null,
      avgHoursToResolve: null,
    });
    mocks.getOverdueComplaintPreviews.mockResolvedValue([]);
    mocks.sendWeeklyDigest.mockResolvedValue({ success: true });
    mocks.sendOwnerDigest.mockResolvedValue({ success: true });
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 2, sent: 1, failed: 1 });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('pushes to each quiet location and sends scoped account aggregates', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/cron/weekly-digest',
      { headers: { authorization: 'Bearer quiet-test-secret' } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.quietPush).toEqual({ sent: 4, targeted: 8 });
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledTimes(4);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: '1 mesero dejaron de pedir opiniones',
        body: 'Ana',
        url: '/staff',
        tag: 'quiet-staff-1-2026-W36',
      }),
      { kind: 'quiet_staff' },
    );
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      90,
      expect.objectContaining({ body: '3 meseros en 2 sucursales', url: '/overview' }),
      { kind: 'quiet_staff' },
    );
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      91,
      expect.objectContaining({ body: '1 meseros en 1 sucursales', url: '/overview' }),
      { kind: 'quiet_staff' },
    );
    expect(mocks.sendWeeklyDigest).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantName: 'Norte', quietStaff: [quietAna] }),
    );
    expect(mocks.sendOwnerDigest).toHaveBeenCalledWith(expect.objectContaining({
      locations: expect.arrayContaining([
        expect.objectContaining({
          name: 'Norte',
          quietStaff: [quietAna],
          topStaff: [{ name: 'Luz', avgRating: 4.9, reviewCount: 41 }],
        }),
      ]),
    }));
  });
});

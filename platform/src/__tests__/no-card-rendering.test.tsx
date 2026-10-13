import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  whereArgs: [] as unknown[],
}));

vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

// Chainable stand-in for drizzle: every builder step returns itself, `where`
// records its condition, and awaiting the chain resolves to [].
vi.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'from', 'groupBy', 'orderBy', 'limit']) {
    chain[step] = () => chain;
  }
  chain.where = (cond: unknown) => {
    mocks.whereArgs.push(cond);
    return chain;
  };
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve([]);
  return { db: chain };
});

import DashboardView from '@/components/dashboard/DashboardView';
import AnalyticsView from '@/components/dashboard/AnalyticsView';
import LiveView from '@/components/dashboard/LiveView';
import { sendWeeklyDigest } from '@/lib/email';
import { getLastWeekLeaderboard } from '@/lib/queries';

const QR = 'QR del restaurante';
const RANKING_TITLE = 'Clasificación del Personal';

/* ── Dashboard ── */

const stats = { totalReviews: 10, avgRating: 4.5, googleSends: 6 };
const roiStats = {
  totalReviews: 10,
  avgRating: 4.5,
  googleSends: 6,
  intercepted: 0,
  feedbackCount: 0,
  firstReviewAt: null,
};

interface Entry {
  staffId: number | null;
  staffName: string | null;
  staffCode: string | null;
  avgRating: number;
  reviewCount: number;
}

const ana: Entry = { staffId: 1, staffName: 'Ana', staffCode: 'ANA', avgRating: 4.9, reviewCount: 6 };
const beto: Entry = { staffId: 2, staffName: 'Beto', staffCode: 'BETO', avgRating: 4.2, reviewCount: 3 };
// staff_code IS NULL: a rating from the restaurant QR, no card.
const noCard: Entry = { staffId: null, staffName: null, staffCode: null, avgRating: 5, reviewCount: 4 };
// A removed staff member: the code survives, the staff row does not. Stays as today.
const removed: Entry = { staffId: null, staffName: 'Pablo', staffCode: 'PABLO', avgRating: 4, reviewCount: 2 };

function dashboard(leaderboard: Entry[], extra: { hasStaff?: boolean } = {}): string {
  return renderToStaticMarkup(
    <DashboardView
      stats={stats}
      lastWeekStats={stats}
      leaderboard={leaderboard}
      unreadCount={0}
      unreadLowCount={0}
      roiStats={roiStats}
      monthlyStats={[]}
      googleTrend={null}
      googleHistory={[]}
      googleRating={null}
      googleReviewCount={null}
      googleReviewsToday={null}
      {...extra}
    />,
  );
}

describe('DashboardView no-card ratings', () => {
  it('keeps no-card out of the ranking and shows one QR line', () => {
    const html = dashboard([ana, beto, noCard]);
    expect(html).toContain(RANKING_TITLE);
    expect(html).toContain('Ana');
    expect(html).toContain('Beto');
    // Two ranked rows only: 01 and 02, never a 03 for the QR row.
    expect(html).toContain('01');
    expect(html).toContain('02');
    expect(html).not.toContain('03');
    expect(html).toContain(`${QR}: 4`);
    expect(html).not.toContain('Desconocido');
  });

  it('shows the QR line, not an empty ranking row, when only no-card ratings exist', () => {
    const html = dashboard([noCard]);
    expect(html).toContain('Sin actividad esta semana');
    expect(html).toContain(`${QR}: 4`);
    expect(html).not.toContain('Desconocido');
  });

  it('keeps a removed-staff code in the ranking as today', () => {
    const html = dashboard([ana, removed]);
    expect(html).toContain('Pablo');
    expect(html).toContain('PABLO');
    expect(html).not.toContain(QR);
  });

  it('hides the whole ranking card for a restaurant with 0 staff', () => {
    const html = dashboard([noCard], { hasStaff: false });
    expect(html).not.toContain(RANKING_TITLE);
    expect(html).not.toContain('Sin actividad esta semana');
    expect(html).not.toContain(QR);
  });

  it('legacy (staff-only data) output is unchanged and never mentions the QR line', () => {
    const legacy = dashboard([ana, beto]);
    expect(legacy).toBe(dashboard([ana, beto], { hasStaff: true }));
    expect(legacy).toContain(RANKING_TITLE);
    expect(legacy).not.toContain(QR);
    // Exact ranked-row shape: rank, name + code, average, count.
    expect(legacy).toMatch(/>01<\/td>.*Ana.*ANA.*4\.9.*>6<\/td>.*>02<\/td>.*Beto.*BETO.*4\.2.*>3<\/td>/);
  });
});

/* ── Analytics ── */

const rankRow = (s: Entry, five: number, below: number) => ({
  staffId: s.staffId,
  staffName: s.staffName,
  staffCode: s.staffCode,
  reviewCount: s.reviewCount,
  avgRating: s.avgRating,
  fiveStarCount: five,
  belowFourCount: below,
});

function analytics(ranking: ReturnType<typeof rankRow>[], extra: { hasStaff?: boolean } = {}): string {
  return renderToStaticMarkup(
    <AnalyticsView
      weeklyStats={stats}
      allTimeStats={{ ...stats, feedbackCount: 0 }}
      dailyCounts={[]}
      conversion={{ rate: 0, above: 0, sent: 0 }}
      staffRanking={ranking}
      roiStats={roiStats}
      googleTrend={null}
      {...extra}
    />,
  );
}

describe('AnalyticsView no-card ratings', () => {
  const rows = [rankRow(ana, 5, 0), rankRow(beto, 2, 1)];
  const qrRow = rankRow(noCard, 4, 0);

  it('keeps no-card out of the ranking and shows one QR line', () => {
    const html = analytics([...rows, qrRow]);
    expect(html).toContain('Ranking de Personal');
    expect(html).toContain('Ana');
    expect(html).not.toContain('03');
    expect(html).toContain(`${QR}: 4`);
    expect(html).not.toContain('Desconocido');
  });

  it('hides the ranking section for a restaurant with 0 staff', () => {
    const html = analytics([qrRow], { hasStaff: false });
    expect(html).not.toContain('Ranking de Personal');
    expect(html).not.toContain(QR);
  });

  it('legacy output is unchanged', () => {
    const legacy = analytics(rows);
    expect(legacy).toBe(analytics(rows, { hasStaff: true }));
    expect(legacy).toContain('Ranking de Personal');
    expect(legacy).not.toContain(QR);
  });
});

/* ── Live ── */

const totals = (n: number) => ({
  totalScans: n,
  fiveStarCount: n,
  belowFourCount: 0,
  intercepted: 0,
  sentToGoogle: n,
});

const liveStat = (
  s: { staffId: number | null; staffName: string | null; staffCode: string | null },
  scans: number,
) => ({
  ...s,
  totalScans: scans,
  fiveStarCount: scans,
  belowFourCount: 0,
  avgRating: 5,
  todayScans: scans,
  todayFiveStars: scans,
  todayBelowFour: 0,
});

function live(opts: {
  stats: ReturnType<typeof liveStat>[];
  allStaff: { id: number; name: string; code: string; active: boolean }[];
}): string {
  const total = opts.stats.reduce((n, s) => n + s.totalScans, 0);
  return renderToStaticMarkup(
    <LiveView
      restaurantName="Centro"
      logoSrc=""
      logoDarkBg={false}
      googleRating={null}
      googleReviewCount={null}
      googleReviewsToday={null}
      googleTrend={null}
      initialData={{
        week: totals(total),
        lastWeek: totals(0),
        today: totals(total),
        staffStats: opts.stats,
        lastWeekStaffStats: [],
        allStaff: opts.allStaff,
        recentScans: [],
      }}
    />,
  );
}

describe('LiveView no-card ratings', () => {
  const allStaff = [
    { id: 1, name: 'Ana', code: 'ANA', active: true },
    { id: 2, name: 'Beto', code: 'BETO', active: true },
  ];

  it('excludes no-card from the podium and the team table, with one QR line', () => {
    const html = live({
      // The QR row has the most scans: it would top the podium if it were ranked.
      stats: [liveStat(ana, 3), liveStat(beto, 1), liveStat(noCard, 9)],
      allStaff,
    });
    expect(html).toContain('LÍDERES DEL DÍA');
    expect(html).toContain('ÍNDICE DE PERSONAL');
    expect(html).toContain(`${QR}: 9`);
    expect(html).not.toContain('Unknown');
    expect(html).not.toContain('Desconocido');
    expect(html).not.toContain('>03<');
  });

  it('renders no podium and no team table for a restaurant with 0 staff', () => {
    const html = live({ stats: [liveStat(noCard, 5)], allStaff: [] });
    expect(html).not.toContain('LÍDERES DEL DÍA');
    expect(html).not.toContain('ÍNDICE DE PERSONAL');
    expect(html).not.toContain(QR);
  });

  it('legacy (staff-only data) output has podium and table and no QR line', () => {
    const html = live({ stats: [liveStat(ana, 3), liveStat(beto, 1)], allStaff });
    expect(html).toContain('LÍDERES DEL DÍA');
    expect(html).toContain('ÍNDICE DE PERSONAL');
    expect(html).not.toContain(QR);
  });
});

/* ── Weekly digest ── */

const weekStats = { totalReviews: 20, avgRating: 4.8, googleSends: 12, intercepted: 0 };

function visibleText(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

async function digestHtml(extra: { hasStaff?: boolean; topPerformers?: unknown[]; total?: number } = {}) {
  mocks.sendMail.mockClear();
  mocks.sendMail.mockResolvedValue({ success: true, skipped: false, messageId: 'm', response: null, error: null });
  await sendWeeklyDigest({
    to: 'gm@example.com',
    restaurantName: 'Centro',
    lastWeek: { ...weekStats, totalReviews: extra.total ?? weekStats.totalReviews },
    weekBefore: weekStats,
    unresolvedCount: 0,
    topPerformers: (extra.topPerformers ?? [
      { staffName: 'Ana', staffCode: 'ANA', avgRating: 4.9, reviewCount: 6 },
    ]) as never,
    dashboardUrl: 'https://example.com/dashboard',
    ...(extra.hasStaff === undefined ? {} : { hasStaff: extra.hasStaff }),
  });
  return mocks.sendMail.mock.calls[0][0].html as string;
}

describe('weekly digest "Top meseros"', () => {
  it('omits the block for a restaurant with 0 staff', async () => {
    const text = visibleText(await digestHtml({ hasStaff: false, topPerformers: [] }));
    expect(text).not.toContain('Top meseros');
    expect(text).not.toContain('Sin opiniones');
  });

  it('keeps the block unchanged for a restaurant with staff (default)', async () => {
    const withDefault = await digestHtml();
    const withTrue = await digestHtml({ hasStaff: true });
    expect(withDefault).toBe(withTrue);
    const text = visibleText(withDefault);
    expect(text).toContain('Top meseros por experiencia del cliente');
    expect(text).toContain('Ana');
    expect(text).toContain('6 opiniones capturadas');
  });

  it('does not claim zero opinions when only no-card ratings came in', async () => {
    const text = visibleText(await digestHtml({ topPerformers: [], total: 5 }));
    expect(text).toContain('Top meseros');
    expect(text).not.toContain('Sin opiniones capturadas la semana pasada');
    expect(text).toContain('Sin opiniones con tarjeta de mesero la semana pasada');
  });

  it('keeps the legacy empty-week message when there are no ratings at all', async () => {
    const text = visibleText(await digestHtml({ topPerformers: [], total: 0 }));
    expect(text).toContain('Sin opiniones capturadas la semana pasada');
  });
});

describe('getLastWeekLeaderboard query', () => {
  beforeEach(() => {
    mocks.whereArgs.length = 0;
  });

  it('filters no-card ratings (staff_code IS NULL) out in SQL', async () => {
    await getLastWeekLeaderboard(1, 5);
    expect(mocks.whereArgs).toHaveLength(1);
    const { sql: text } = new PgDialect().sqlToQuery(mocks.whereArgs[0] as never);
    expect(text).toContain('"staff_code" is not null');
  });
});

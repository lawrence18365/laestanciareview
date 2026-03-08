'use client';

import { downloadCSV } from '@/lib/csv';
import { t } from '@/lib/i18n';

/* ── Types ── */

interface Stats {
  totalReviews: number;
  avgRating: number;
  googleSends: number;
}

interface LeaderboardEntry {
  staffId: number | null;
  staffName: string | null;
  staffCode: string | null;
  avgRating: number;
  reviewCount: number;
}

interface ROIStats {
  totalReviews: number;
  avgRating: number;
  googleSends: number;
  intercepted: number;
  feedbackCount: number;
  firstReviewAt: Date | string | null;
}

interface MonthlyStatEntry {
  month: string;
  reviewCount: number;
  avgRating: number;
  googleSends: number;
  intercepted: number;
}

interface GoogleTrend {
  baselineRating: number;
  baselineReviewCount: number;
  baselineDate: Date | string;
  currentRating: number;
  currentReviewCount: number;
  currentDate: Date | string;
  ratingChange: number;
  reviewsGained: number;
}

interface GoogleSnapshot {
  rating: string;
  reviewCount: number;
  date: Date | string;
}

interface Props {
  stats: Stats;
  lastWeekStats: Stats;
  leaderboard: LeaderboardEntry[];
  unreadCount: number;
  unreadLowCount: number;
  roiStats: ROIStats;
  monthlyStats: MonthlyStatEntry[];
  googleTrend: GoogleTrend | null;
  googleHistory: GoogleSnapshot[];
  googleRating: number | null;
  googleReviewCount: number | null;
}

/* ── Styles ── */

const sectionTitle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-main)',
  margin: '0 0 1.25rem 0',
  borderBottom: '1px solid var(--panel-border)',
  paddingBottom: '0.75rem',
};

const emptyText: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: '0.85rem',
  fontStyle: 'italic',
  fontFamily: 'var(--font-serif)',
  textAlign: 'center',
  padding: '2rem 0',
  margin: 0,
};

/* ── Main Component ── */

export default function DashboardView({
  stats,
  lastWeekStats,
  leaderboard,
  unreadCount,
  unreadLowCount,
  roiStats,
  monthlyStats,
  googleTrend,
  googleHistory,
  googleRating,
  googleReviewCount,
}: Props) {
  // Weeks active calculation
  const firstReview = roiStats.firstReviewAt ? new Date(roiStats.firstReviewAt) : null;
  const weeksActive = firstReview
    ? Math.max(1, Math.round((Date.now() - firstReview.getTime()) / (7 * 24 * 60 * 60 * 1000)))
    : 0;
  const avgReviewsPerWeek = weeksActive > 0 ? (roiStats.totalReviews / weeksActive).toFixed(1) : '0';

  // Google review conversion: sends vs actual Google review growth
  const googleConversionText = googleTrend && googleTrend.reviewsGained > 0
    ? t.dashboard.googleConversion(roiStats.googleSends, googleTrend.reviewsGained)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '2rem' }}>
      
      {/* ── HEADER ── */}
      <div>
        <h1 className="editorial-serif" style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 0.5rem 0', letterSpacing: '-0.02em' }}>
          {t.nav.dashboard}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', letterSpacing: '0.02em' }}>
          Resumen de rendimiento y métricas clave.
        </p>
      </div>

      {/* ── URGENT: Unread negative feedback ── */}
      {unreadLowCount > 0 && (
        <a
          href="/inbox"
          className="flat-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1.25rem 1.5rem',
            background: 'var(--bg-base)',
            borderLeft: '4px solid var(--red)',
            textDecoration: 'none',
            color: 'var(--text-main)',
          }}
        >
          <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--red)' }}>!</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.dashboard.negativeReviewNeedsAttention(unreadLowCount)}
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t.dashboard.belowThreshold}
            </p>
          </div>
        </a>
      )}

      {unreadCount > 0 && unreadLowCount === 0 && (
        <a
          href="/inbox"
          className="flat-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1.25rem 1.5rem',
            background: 'var(--bg-base)',
            borderLeft: '4px solid var(--gold)',
            textDecoration: 'none',
            color: 'var(--text-main)',
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.dashboard.unreadFeedback(unreadCount)}
            </p>
          </div>
        </a>
      )}

      {/* ── RateTap Impact — real data, no estimates ── */}
      {roiStats.totalReviews > 0 && (
        <div className="flat-panel" style={{ padding: '2rem', background: 'var(--border-dark)', color: 'var(--panel-bg)' }}>
          <div
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-dim)',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid #333',
              paddingBottom: 10,
            }}
          >
            <span style={{ width: 6, height: 6, background: 'var(--gold)' }} />
            {t.dashboard.rateTapImpact}
          </div>

          {/* Hero: Google Rating if we have trend data */}
          {googleTrend ? (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                <span className="font-numeric" style={{ fontSize: '1.5rem', color: 'var(--text-dim)', fontWeight: 500 }}>
                  {googleTrend.baselineRating.toFixed(1)}
                </span>
                <span style={{ color: 'var(--text-dim)' }}>→</span>
                <span
                  className="editorial-serif"
                  style={{
                    fontSize: '4rem',
                    fontWeight: 600,
                    lineHeight: 1,
                    color: 'var(--panel-bg)',
                  }}
                >
                  {googleTrend.currentRating.toFixed(1)}
                </span>
                <span style={{ color: 'var(--gold)', fontSize: '2rem' }}>★</span>
                {googleTrend.ratingChange !== 0 && (
                  <span
                    className="font-numeric"
                    style={{
                      padding: '4px 8px',
                      border: `1px solid ${googleTrend.ratingChange > 0 ? 'var(--green)' : 'var(--red)'}`,
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: googleTrend.ratingChange > 0 ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t.dashboard.googleRatingSinceStart}
              </div>
            </div>
          ) : googleRating != null ? (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                <span className="editorial-serif" style={{ fontSize: '4rem', fontWeight: 600, lineHeight: 1 }}>
                  {googleRating.toFixed(1)}
                </span>
                <span style={{ color: 'var(--gold)', fontSize: '2rem' }}>★</span>
                {googleReviewCount != null && (
                  <span className="font-numeric" style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginLeft: 8 }}>
                    {googleReviewCount.toLocaleString()} {t.dashboard.googleReviews}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t.dashboard.currentGoogleRating}
              </div>
            </div>
          ) : null}

          {/* Breakdown cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: googleConversionText ? '1.5rem' : 0,
            }}
          >
            {/* Sent to Google */}
            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                  {t.dashboard.sentToGoogle}
                </span>
              </div>
              <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--panel-bg)' }}>
                {roiStats.googleSends}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {googleTrend && googleTrend.reviewsGained > 0
                  ? t.dashboard.newGoogleReviewsConfirmed(googleTrend.reviewsGained)
                  : t.dashboard.customersDirectedToGoogle}
              </div>
            </div>

            {/* Negative reviews intercepted */}
            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                  {t.dashboard.badReviewsPrevented}
                </span>
              </div>
              <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--panel-bg)' }}>
                {roiStats.intercepted}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {t.dashboard.negativeReviewsCaughtPrivately}
              </div>
            </div>

            {/* Review velocity */}
            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                  {t.dashboard.reviewVelocity}
                </span>
              </div>
              <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--panel-bg)' }}>
                {avgReviewsPerWeek}<span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>/sem</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {t.dashboard.totalOverWeeks(roiStats.totalReviews, weeksActive)}
              </div>
            </div>
          </div>

          {/* Conversion story */}
          {googleConversionText && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
              {googleConversionText}
            </div>
          )}
        </div>
      )}

      {/* ── Weekly Stats Row with week-over-week ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <StatCard
          label={t.dashboard.reviewsThisWeek}
          value={stats.totalReviews}
          delta={stats.totalReviews - lastWeekStats.totalReviews}
          deltaLabel={t.dashboard.vsLastWeek}
        />
        <StatCard
          label={t.dashboard.avgRating}
          value={stats.avgRating ? stats.avgRating.toFixed(1) : '--'}
          suffix=" / 5"
          delta={stats.avgRating && lastWeekStats.avgRating
            ? parseFloat((stats.avgRating - lastWeekStats.avgRating).toFixed(1))
            : null}
          deltaLabel={t.dashboard.vsLastWeek}
        />
        <StatCard
          label={t.dashboard.googleSends}
          value={stats.googleSends}
          delta={stats.googleSends - lastWeekStats.googleSends}
          deltaLabel={t.dashboard.vsLastWeek}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
        {/* ── Google Rating Trend Chart ── */}
        {googleHistory.length >= 2 && (
          <section className="flat-panel" style={{ padding: '1.5rem' }}>
            <h2 style={sectionTitle}>{t.dashboard.googleRatingOverTime}</h2>
            <GoogleRatingChart snapshots={googleHistory} />
          </section>
        )}

        {/* ── Monthly Trend ── */}
        {monthlyStats.length >= 2 && (
          <section className="flat-panel" style={{ padding: '1.5rem' }}>
            <h2 style={sectionTitle}>{t.dashboard.monthlyTrend}</h2>
            <MonthlyChart data={monthlyStats} />
          </section>
        )}
      </div>

      {/* ── Leaderboard ── */}
      <section className="flat-panel" style={{ padding: '0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem', borderBottom: '1px solid var(--panel-border)', background: 'var(--bg-base)' }}>
          <h2 style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-main)', margin: 0 }}>
            {t.dashboard.staffLeaderboard}
          </h2>
          {leaderboard.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  leaderboard.map((e, i) => ({
                    Rank: i + 1,
                    Staff: e.staffName ?? t.dashboard.unknown,
                    Code: e.staffCode ?? '',
                    'Avg Rating': e.avgRating.toFixed(1),
                    Reviews: e.reviewCount,
                  })),
                  'leaderboard.csv',
                )
              }
              style={{
                padding: '0.4rem 1rem',
                border: '1px solid var(--border-dark)',
                background: 'var(--panel-bg)',
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--text-main)';
                e.currentTarget.style.color = 'var(--panel-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--panel-bg)';
                e.currentTarget.style.color = 'var(--text-main)';
              }}
            >
              {t.dashboard.exportCsv}
            </button>
          )}
        </div>
        {leaderboard.length === 0 ? (
          <p style={emptyText}>{t.dashboard.noReviewsThisWeek}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: 'var(--panel-bg)' }}>
                <tr>
                  <Th align="center" style={{ width: 60, borderBottom: '2px solid var(--border-dark)' }}>{t.dashboard.rank}</Th>
                  <Th align="left" style={{ borderBottom: '2px solid var(--border-dark)' }}>{t.dashboard.staffCol}</Th>
                  <Th align="right" style={{ borderBottom: '2px solid var(--border-dark)' }}>{t.dashboard.avgRatingCol}</Th>
                  <Th align="right" style={{ borderBottom: '2px solid var(--border-dark)' }}>{t.dashboard.reviewsCol}</Th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr
                    key={entry.staffId ?? i}
                    style={{ borderBottom: '1px solid var(--panel-border)', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-base)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Td align="center" style={{ color: 'var(--text-muted)' }}>
                      <span className="font-numeric">{String(i + 1).padStart(2, '0')}</span>
                    </Td>
                    <Td align="left">
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{entry.staffName ?? t.dashboard.unknown}</span>
                      {entry.staffCode && (
                        <span className="font-numeric" style={{ color: 'var(--text-muted)', marginLeft: 12, fontSize: '0.75rem' }}>
                          {entry.staffCode}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="font-numeric" style={{ fontWeight: 600, color: 'var(--text-main)' }}>{entry.avgRating.toFixed(1)}</span>
                    </Td>
                    <Td align="right" className="font-numeric" style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                      {entry.reviewCount}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Google Rating Chart ── */

function GoogleRatingChart({ snapshots }: { snapshots: GoogleSnapshot[] }) {
  if (snapshots.length < 2) return null;

  const ratings = snapshots.map((s) => parseFloat(s.rating));
  const minR = Math.floor(Math.min(...ratings) * 10) / 10 - 0.1;
  const maxR = Math.ceil(Math.max(...ratings) * 10) / 10 + 0.1;
  const range = maxR - minR || 1;

  const W = 600;
  const H = 160;
  const padX = 40;
  const padY = 20;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  const points = snapshots.map((s, i) => {
    const x = padX + (i / (snapshots.length - 1)) * plotW;
    const y = padY + plotH - ((parseFloat(s.rating) - minR) / range) * plotH;
    return { x, y, rating: parseFloat(s.rating), date: s.date, reviewCount: s.reviewCount };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padY + plotH} L ${points[0].x} ${padY + plotH} Z`;

  const first = points[0];
  const last = points[points.length - 1];
  const lineColor = last.rating >= first.rating ? 'var(--green)' : 'var(--red)';

  const firstDate = new Date(snapshots[0].date);
  const lastDate = new Date(snapshots[snapshots.length - 1].date);

  return (
    <div style={{ overflowX: 'auto', paddingTop: '1rem' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + plotH * (1 - frac);
          const val = (minR + range * frac).toFixed(1);
          return (
            <g key={frac}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--panel-border)" strokeWidth={1} strokeDasharray="4 4" />
              <text className="font-numeric" x={padX - 10} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {val}
              </text>
            </g>
          );
        })}

        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--text-main)" strokeWidth={2} strokeLinejoin="miter" />

        {/* Start and end dots */}
        <rect x={first.x - 3} y={first.y - 3} width={6} height={6} fill="var(--panel-bg)" stroke="var(--text-main)" strokeWidth={2} />
        <rect x={last.x - 4} y={last.y - 4} width={8} height={8} fill="var(--text-main)" />

        {/* Labels */}
        <text className="font-numeric" x={first.x} y={first.y - 12} textAnchor="start" fontSize={12} fontWeight={600} fill="var(--text-main)">
          {first.rating.toFixed(1)}
        </text>
        <text className="font-numeric" x={last.x} y={last.y - 12} textAnchor="end" fontSize={14} fontWeight={700} fill="var(--text-main)">
          {last.rating.toFixed(1)}
        </text>

        {/* Date labels */}
        <text className="font-numeric" x={padX} y={H - 2} fontSize={10} fill="var(--text-muted)" textAnchor="start">
          {firstDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        </text>
        <text className="font-numeric" x={W - padX} y={H - 2} textAnchor="end" fontSize={10} fill="var(--text-muted)">
          {lastDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        </text>
      </svg>
    </div>
  );
}

/* ── Monthly Trend Chart ── */

function MonthlyChart({ data }: { data: MonthlyStatEntry[] }) {
  const maxCount = Math.max(...data.map((d) => d.reviewCount), 1);

  return (
    <div style={{ overflowX: 'auto', paddingTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, minHeight: 120, minWidth: data.length * 50, padding: '0 0.5rem' }}>
        {data.map((d) => {
          const h = (d.reviewCount / maxCount) * 100;
          const [year, month] = d.month.split('-');
          const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('es-MX', { month: 'short' });
          return (
            <div key={d.month} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span className="font-numeric" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>{d.reviewCount}</span>
              <div style={{ display: 'flex', width: '100%', overflow: 'hidden', flexDirection: 'column-reverse', border: '1px solid var(--border-dark)', background: 'var(--bg-base)' }}>
                {/* Google sends portion */}
                <div
                  style={{
                    height: Math.max((d.googleSends / maxCount) * 100, d.googleSends > 0 ? 3 : 0),
                    background: 'var(--text-main)',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.googleSends} ${t.dashboard.sentToGoogleChart}`}
                />
                {/* Intercepted portion */}
                <div
                  style={{
                    height: Math.max((d.intercepted / maxCount) * 100, d.intercepted > 0 ? 3 : 0),
                    background: 'var(--text-dim)',
                    borderBottom: d.intercepted > 0 && d.googleSends > 0 ? '1px solid var(--panel-bg)' : 'none',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.intercepted} ${t.dashboard.interceptedChart}`}
                />
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-muted)', textTransform: 'uppercase', justifyContent: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, background: 'var(--text-main)', border: '1px solid var(--border-dark)' }} />
          {t.dashboard.sentToGoogle}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, background: 'var(--text-dim)', border: '1px solid var(--border-dark)' }} />
          {t.dashboard.intercepted}
        </span>
      </div>
    </div>
  );
}

/* ── Helper Components ── */

function StatCard({
  label,
  value,
  suffix,
  delta,
  deltaLabel,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: number | null;
  deltaLabel?: string;
}) {
  const showDelta = delta != null && delta !== 0;
  const positive = delta != null && delta > 0;

  return (
    <div className="flat-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
      <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {label}
      </p>
      <p className="editorial-serif" style={{ margin: 0, fontSize: '3rem', fontWeight: 400, color: 'var(--text-main)', lineHeight: 1 }}>
        {value}
        {suffix && (
          <span className="font-numeric" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-dim)', marginLeft: 8 }}>
            {suffix}
          </span>
        )}
      </p>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        borderTop: '1px solid var(--panel-border)',
        paddingTop: 12,
        marginTop: 'auto'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
           <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
             ESTA SEMANA
           </span>
        </div>
        {showDelta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-main)' }}>
               {positive ? '↑' : '↓'}
            </span>
            <span className="font-numeric" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>
              {Math.abs(delta)}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              VS {deltaLabel?.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, align, style }: { children: React.ReactNode; align: 'left' | 'right' | 'center'; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '1rem 1.5rem',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        ...style
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
  style: extra,
}: {
  children: React.ReactNode;
  align: 'left' | 'right' | 'center';
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td
      className={className}
      style={{
        textAlign: align,
        padding: '1rem 1.5rem',
        fontSize: '0.85rem',
        ...extra,
      }}
    >
      {children}
    </td>
  );
}

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

const card: React.CSSProperties = {
  background: 'var(--warm-white)',
  borderRadius: 10,
  padding: '1.5rem',
  boxShadow: 'var(--shadow-sm)',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-cormorant), serif',
  fontSize: '1.3rem',
  fontWeight: 600,
  marginTop: 0,
  marginBottom: '1rem',
  color: 'var(--espresso)',
};

const emptyText: React.CSSProperties = {
  color: 'var(--stone-400)',
  fontSize: '0.9rem',
  fontStyle: 'italic',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* ── URGENT: Unread negative feedback ── */}
      {unreadLowCount > 0 && (
        <a
          href="/inbox"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.25rem',
            borderRadius: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            textDecoration: 'none',
            color: '#991b1b',
            transition: 'background 0.15s',
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>!</span>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>
              {t.dashboard.negativeReviewNeedsAttention(unreadLowCount)}
            </p>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#b91c1c' }}>
              {t.dashboard.belowThreshold}
            </p>
          </div>
        </a>
      )}

      {unreadCount > 0 && unreadLowCount === 0 && (
        <a
          href="/inbox"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.85rem 1.25rem',
            borderRadius: 10,
            background: '#fefce8',
            border: '1px solid #fde68a',
            textDecoration: 'none',
            color: '#92400e',
            transition: 'background 0.15s',
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
              {t.dashboard.unreadFeedback(unreadCount)}
            </p>
          </div>
        </a>
      )}

      {/* ── RateTap Impact — real data, no estimates ── */}
      {roiStats.totalReviews > 0 && (
        <div
          style={{
            background: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
            borderRadius: 14,
            padding: '2rem',
            color: '#fafaf9',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Subtle gold accent */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'linear-gradient(90deg, #f59e0b, #d97706, #f59e0b)',
            }}
          />

          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#f59e0b',
              marginBottom: '1.25rem',
            }}
          >
            {t.dashboard.rateTapImpact}
          </div>

          {/* Hero: Google Rating if we have trend data */}
          {googleTrend ? (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.4rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                  {googleTrend.baselineRating.toFixed(1)}
                </span>
                <svg width={28} height={14} viewBox="0 0 28 14" style={{ flexShrink: 0, alignSelf: 'center' }}>
                  <line x1="0" y1="7" x2="20" y2="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                  <polygon points="20,2 28,7 20,12" fill="rgba(255,255,255,0.3)" />
                </svg>
                <span
                  style={{
                    fontSize: '3.2rem',
                    fontWeight: 800,
                    lineHeight: 1,
                    color: '#fafaf9',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {googleTrend.currentRating.toFixed(1)}
                </span>
                <span style={{ color: 'var(--amber-500)', fontSize: '2rem' }}>★</span>
                {googleTrend.ratingChange !== 0 && (
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      background: googleTrend.ratingChange > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: googleTrend.ratingChange > 0 ? '#4ade80' : '#f87171',
                    }}
                  >
                    {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                {t.dashboard.googleRatingSinceStart}
              </div>
            </div>
          ) : googleRating != null ? (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '3.2rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {googleRating.toFixed(1)}
                </span>
                <span style={{ color: 'var(--amber-500)', fontSize: '2rem' }}>★</span>
                {googleReviewCount != null && (
                  <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)', marginLeft: 4 }}>
                    ({googleReviewCount.toLocaleString()} {t.dashboard.googleReviews})
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                {t.dashboard.currentGoogleRating}
              </div>
            </div>
          ) : null}

          {/* Breakdown cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              marginBottom: googleConversionText ? '1rem' : 0,
            }}
          >
            {/* Sent to Google */}
            <div
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                borderRadius: 10,
                padding: '1rem 1.15rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2} strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
                  {t.dashboard.sentToGoogle}
                </span>
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#4ade80' }}>
                {roiStats.googleSends}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                {googleTrend && googleTrend.reviewsGained > 0
                  ? t.dashboard.newGoogleReviewsConfirmed(googleTrend.reviewsGained)
                  : t.dashboard.customersDirectedToGoogle}
              </div>
            </div>

            {/* Negative reviews intercepted */}
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: 10,
                padding: '1rem 1.15rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={2}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
                  {t.dashboard.badReviewsPrevented}
                </span>
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#fbbf24' }}>
                {roiStats.intercepted}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                {t.dashboard.negativeReviewsCaughtPrivately}
              </div>
            </div>

            {/* Review velocity */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '1rem 1.15rem',
              }}
            >
              <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                {t.dashboard.reviewVelocity}
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#fafaf9' }}>
                {avgReviewsPerWeek}<span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>{t.dashboard.perWeek}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                {t.dashboard.totalOverWeeks(roiStats.totalReviews, weeksActive)}
              </div>
            </div>
          </div>

          {/* Conversion story */}
          {googleConversionText && (
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.25rem' }}>
              {googleConversionText}
            </div>
          )}
        </div>
      )}

      {/* ── Google Rating Trend Chart ── */}
      {googleHistory.length >= 2 && (
        <section style={card}>
          <h2 style={sectionTitle}>{t.dashboard.googleRatingOverTime}</h2>
          <GoogleRatingChart snapshots={googleHistory} />
        </section>
      )}

      {/* ── Weekly Stats Row with week-over-week ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
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
          suffix="/5"
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

      {/* ── Monthly Trend ── */}
      {monthlyStats.length >= 2 && (
        <section style={card}>
          <h2 style={sectionTitle}>{t.dashboard.monthlyTrend}</h2>
          <MonthlyChart data={monthlyStats} />
        </section>
      )}

      {/* ── Leaderboard ── */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t.dashboard.staffLeaderboard}</h2>
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
                padding: '0.35rem 0.8rem',
                borderRadius: 6,
                border: '1px solid var(--stone-300)',
                background: 'transparent',
                fontSize: '0.8rem',
                cursor: 'pointer',
                color: 'var(--stone-700)',
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
              <thead>
                <tr>
                  <Th align="left">{t.dashboard.rank}</Th>
                  <Th align="left">{t.dashboard.staffCol}</Th>
                  <Th align="right">{t.dashboard.avgRatingCol}</Th>
                  <Th align="right">{t.dashboard.reviewsCol}</Th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr
                    key={entry.staffId ?? i}
                    style={{ borderTop: '1px solid var(--stone-200)' }}
                  >
                    <Td align="left" style={{ fontWeight: 600, color: 'var(--stone-500)' }}>
                      {i + 1}
                    </Td>
                    <Td align="left">
                      <span style={{ fontWeight: 500 }}>{entry.staffName ?? t.dashboard.unknown}</span>
                      <span style={{ color: 'var(--stone-400)', marginLeft: 8, fontSize: '0.8rem' }}>
                        {entry.staffCode}
                      </span>
                    </Td>
                    <Td align="right">
                      <span style={{ fontWeight: 600 }}>{entry.avgRating.toFixed(1)}</span>
                      <span style={{ color: 'var(--amber-500)', marginLeft: 4 }}>★</span>
                    </Td>
                    <Td align="right">{entry.reviewCount}</Td>
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
  const lineColor = last.rating >= first.rating ? '#22c55e' : '#ef4444';

  const firstDate = new Date(snapshots[0].date);
  const lastDate = new Date(snapshots[snapshots.length - 1].date);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + plotH * (1 - frac);
          const val = (minR + range * frac).toFixed(1);
          return (
            <g key={frac}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--stone-200)" strokeWidth={0.5} />
              <text x={padX - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--stone-400)">
                {val}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={lineColor} opacity={0.06} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Start and end dots */}
        <circle cx={first.x} cy={first.y} r={4} fill={lineColor} opacity={0.4} />
        <circle cx={last.x} cy={last.y} r={5} fill={lineColor} />

        {/* Labels */}
        <text x={first.x} y={first.y - 10} textAnchor="start" fontSize={11} fontWeight={600} fill="var(--stone-500)">
          {first.rating.toFixed(1)}
        </text>
        <text x={last.x} y={last.y - 10} textAnchor="end" fontSize={13} fontWeight={700} fill={lineColor}>
          {last.rating.toFixed(1)}
        </text>

        {/* Date labels */}
        <text x={padX} y={H - 2} fontSize={9} fill="var(--stone-400)">
          {firstDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        </text>
        <text x={W - padX} y={H - 2} textAnchor="end" fontSize={9} fill="var(--stone-400)">
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
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, minHeight: 120, minWidth: data.length * 50, padding: '0 0.25rem' }}>
        {data.map((d) => {
          const h = (d.reviewCount / maxCount) * 100;
          const [year, month] = d.month.split('-');
          const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('es-MX', { month: 'short' });
          return (
            <div key={d.month} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--espresso)' }}>{d.reviewCount}</span>
              <div style={{ display: 'flex', width: '100%', borderRadius: '4px 4px 0 0', overflow: 'hidden', flexDirection: 'column-reverse' }}>
                {/* Google sends portion */}
                <div
                  style={{
                    height: Math.max((d.googleSends / maxCount) * 100, d.googleSends > 0 ? 3 : 0),
                    background: 'var(--success)',
                    borderRadius: d.intercepted > 0 ? 0 : '4px 4px 0 0',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.googleSends} ${t.dashboard.sentToGoogleChart}`}
                />
                {/* Intercepted portion */}
                <div
                  style={{
                    height: Math.max((d.intercepted / maxCount) * 100, d.intercepted > 0 ? 3 : 0),
                    background: '#fbbf24',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.intercepted} ${t.dashboard.interceptedChart}`}
                />
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--stone-400)' }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--stone-500)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--success)' }} />
          {t.dashboard.sentToGoogle}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#fbbf24' }} />
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
    <div style={card}>
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--stone-500)', marginBottom: '0.25rem' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 700, color: 'var(--espresso)' }}>
        {value}
        {suffix && (
          <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--stone-400)' }}>
            {suffix}
          </span>
        )}
      </p>
      {showDelta && (
        <p
          style={{
            margin: '0.3rem 0 0',
            fontSize: '0.8rem',
            fontWeight: 500,
            color: positive ? 'var(--success)' : '#dc2626',
          }}
        >
          {positive ? '+' : ''}{delta} {deltaLabel}
        </p>
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '0.5rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--stone-500)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  style: extra,
}: {
  children: React.ReactNode;
  align: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '0.6rem 0.75rem',
        fontSize: '0.9rem',
        ...extra,
      }}
    >
      {children}
    </td>
  );
}

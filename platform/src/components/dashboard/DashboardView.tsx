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
  const firstReview = roiStats.firstReviewAt ? new Date(roiStats.firstReviewAt) : null;
  const weeksActive = firstReview
    ? Math.max(1, Math.round((Date.now() - firstReview.getTime()) / (7 * 24 * 60 * 60 * 1000)))
    : 0;
  const avgReviewsPerWeek = weeksActive > 0 ? (roiStats.totalReviews / weeksActive).toFixed(1) : '0';

  const googleConversionText = googleTrend && googleTrend.reviewsGained > 0
    ? t.dashboard.googleConversion(roiStats.googleSends, googleTrend.reviewsGained)
    : null;

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ── */}
      <div className="stagger-1">
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 0.25rem 0' }}>
          {t.nav.dashboard}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Resumen de rendimiento y métricas clave.
        </p>
      </div>

      {/* ── Alerts ── */}
      {unreadLowCount > 0 && (
        <a href="/inbox" className="card stagger-2" style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.875rem 1rem', textDecoration: 'none', color: 'var(--text-main)',
          borderLeft: '3px solid var(--red)',
        }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>!</span>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
              {t.dashboard.negativeReviewNeedsAttention(unreadLowCount)}
            </p>
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t.dashboard.belowThreshold}
            </p>
          </div>
        </a>
      )}

      {unreadCount > 0 && unreadLowCount === 0 && (
        <a href="/inbox" className="card stagger-2" style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.875rem 1rem', textDecoration: 'none', color: 'var(--text-main)',
          borderLeft: '3px solid var(--gold)',
        }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </span>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
            {t.dashboard.unreadFeedback(unreadCount)}
          </p>
        </a>
      )}

      {/* ── Impact Section ── */}
      {roiStats.totalReviews > 0 && (
        <div className="card stagger-2" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            background: 'var(--accent-bg)', color: 'var(--accent-fg)',
            padding: '1.5rem',
          }}>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
              {t.dashboard.rateTapImpact}
            </p>

            {/* Google Rating Hero */}
            {googleTrend ? (
              <div style={{ margin: '1rem 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.125rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                    {googleTrend.baselineRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>&rarr;</span>
                  <span style={{ fontSize: '2.75rem', fontWeight: 700, lineHeight: 1 }}>
                    {googleTrend.currentRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--gold)', fontSize: '1.5rem' }}>&#9733;</span>
                  {googleTrend.ratingChange !== 0 && (
                    <span style={{
                      padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                      background: googleTrend.ratingChange > 0 ? 'rgba(26,125,90,0.2)' : 'rgba(201,49,49,0.2)',
                      color: googleTrend.ratingChange > 0 ? '#6EE7B7' : '#FCA5A5',
                    }}>
                      {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                    </span>
                  )}
                </div>
                <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t.dashboard.googleRatingSinceStart}
                </p>
              </div>
            ) : googleRating != null ? (
              <div style={{ margin: '1rem 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '2.75rem', fontWeight: 700, lineHeight: 1 }}>
                    {googleRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--gold)', fontSize: '1.5rem' }}>&#9733;</span>
                  {googleReviewCount != null && (
                    <span style={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>
                      {googleReviewCount.toLocaleString()} {t.dashboard.googleReviews}
                    </span>
                  )}
                </div>
                <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t.dashboard.currentGoogleRating}
                </p>
              </div>
            ) : null}
          </div>

          {/* Impact metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <ImpactMetric
              label={t.dashboard.sentToGoogle}
              value={roiStats.googleSends}
              sub={googleTrend && googleTrend.reviewsGained > 0
                ? t.dashboard.newGoogleReviewsConfirmed(googleTrend.reviewsGained)
                : t.dashboard.customersDirectedToGoogle}
              borderRight
            />
            <ImpactMetric
              label={t.dashboard.badReviewsPrevented}
              value={roiStats.intercepted}
              sub={t.dashboard.negativeReviewsCaughtPrivately}
              borderRight
            />
            <ImpactMetric
              label={t.dashboard.reviewVelocity}
              value={avgReviewsPerWeek}
              valueSuffix="/sem"
              sub={t.dashboard.totalOverWeeks(roiStats.totalReviews, weeksActive)}
            />
          </div>

          {googleConversionText && (
            <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--panel-border)', fontSize: '0.8125rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {googleConversionText}
            </div>
          )}
        </div>
      )}

      {/* ── Weekly Stats ── */}
      <div className="grid-stats stagger-3">
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

      {/* ── Charts ── */}
      <div className="grid-charts stagger-4">
        {googleHistory.length >= 2 && (
          <section className="card" style={{ padding: '1.25rem' }}>
            <h1 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 1rem' }}>
              {t.dashboard.googleRatingOverTime}
            </h1>
            <GoogleRatingChart snapshots={googleHistory} />
          </section>
        )}

        {monthlyStats.length >= 2 && (
          <section className="card" style={{ padding: '1.25rem' }}>
            <h1 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 1rem' }}>
              {t.dashboard.monthlyTrend}
            </h1>
            <MonthlyChart data={monthlyStats} />
          </section>
        )}
      </div>

      {/* ── Leaderboard ── */}
      <section className="card stagger-5" style={{ overflow: 'hidden' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--panel-border)',
        }}>
          <h1 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
            {t.dashboard.staffLeaderboard}
          </h1>
          {leaderboard.length > 0 && (
            <button
              className="btn btn-outline"
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
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
            >
              {t.dashboard.exportCsv}
            </button>
          )}
        </div>

        {leaderboard.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', textAlign: 'center', padding: '2rem 0', margin: 0 }}>
            {t.dashboard.noReviewsThisWeek}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base)' }}>
                  <Th align="center" w={50}>{t.dashboard.rank}</Th>
                  <Th align="left">{t.dashboard.staffCol}</Th>
                  <Th align="right">{t.dashboard.avgRatingCol}</Th>
                  <Th align="right">{t.dashboard.reviewsCol}</Th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr key={entry.staffId ?? i} style={{ borderTop: '1px solid var(--panel-border)' }}>
                    <td style={{ textAlign: 'center', padding: '0.75rem 1rem', fontSize: '0.8125rem', color: 'var(--text-dim)', fontWeight: 500 }}>
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
                      <span style={{ fontWeight: 600 }}>{entry.staffName ?? t.dashboard.unknown}</span>
                      {entry.staffCode && (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {entry.staffCode}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.75rem 1rem', fontSize: '0.8125rem', fontWeight: 600 }}>
                      {entry.avgRating.toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.75rem 1rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {entry.reviewCount}
                    </td>
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

/* ── Impact Metric ── */

function ImpactMetric({ label, value, valueSuffix, sub, borderRight }: {
  label: string;
  value: string | number;
  valueSuffix?: string;
  sub: string;
  borderRight?: boolean;
}) {
  return (
    <div style={{
      padding: '1rem 1.25rem',
      borderRight: borderRight ? '1px solid var(--panel-border)' : 'none',
    }}>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
        {value}
        {valueSuffix && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-dim)', marginLeft: 2 }}>{valueSuffix}</span>}
      </p>
      <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', color: 'var(--text-dim)' }}>
        {sub}
      </p>
    </div>
  );
}

/* ── Stat Card ── */

function StatCard({
  label, value, suffix, delta, deltaLabel,
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
    <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
        {value}
        {suffix && <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--text-dim)', marginLeft: 4 }}>{suffix}</span>}
      </p>
      {showDelta && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: positive ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
          {positive ? '+' : ''}{delta} {deltaLabel}
        </p>
      )}
      {!showDelta && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          esta semana
        </p>
      )}
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

  const firstDate = new Date(snapshots[0].date);
  const lastDate = new Date(snapshots[snapshots.length - 1].date);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + plotH * (1 - frac);
          const val = (minR + range * frac).toFixed(1);
          return (
            <g key={frac}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--panel-border)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={padX - 10} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-dim)">{val}</text>
            </g>
          );
        })}

        <path d={areaPath} fill="rgba(26,125,90,0.06)" />
        <path d={linePath} fill="none" stroke="var(--green)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={first.x} cy={first.y} r={3.5} fill="var(--panel-bg)" stroke="var(--green)" strokeWidth={2} />
        <circle cx={last.x} cy={last.y} r={4} fill="var(--green)" />

        <text x={first.x} y={first.y - 12} textAnchor="start" fontSize={11} fontWeight={600} fill="var(--text-main)">{first.rating.toFixed(1)}</text>
        <text x={last.x} y={last.y - 12} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--text-main)">{last.rating.toFixed(1)}</text>

        <text x={padX} y={H - 2} fontSize={10} fill="var(--text-dim)" textAnchor="start">
          {firstDate.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        </text>
        <text x={W - padX} y={H - 2} textAnchor="end" fontSize={10} fill="var(--text-dim)">
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
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minHeight: 120, minWidth: data.length * 44, padding: '0 0.25rem' }}>
        {data.map((d) => {
          const [year, month] = d.month.split('-');
          const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('es-MX', { month: 'short' });
          return (
            <div key={d.month} style={{ flex: 1, minWidth: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-main)' }}>{d.reviewCount}</span>
              <div style={{ display: 'flex', width: '100%', overflow: 'hidden', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', background: 'var(--bg-base)' }}>
                <div
                  style={{
                    height: Math.max((d.googleSends / maxCount) * 100, d.googleSends > 0 ? 3 : 0),
                    background: 'var(--text-main)',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.googleSends} ${t.dashboard.sentToGoogleChart}`}
                />
                <div
                  style={{
                    height: Math.max((d.intercepted / maxCount) * 100, d.intercepted > 0 ? 3 : 0),
                    background: 'var(--text-dim)',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.intercepted} ${t.dashboard.interceptedChart}`}
                />
              </div>
              <span style={{ fontSize: '0.625rem', color: 'var(--text-dim)' }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '0.6875rem', color: 'var(--text-dim)', justifyContent: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--text-main)' }} />
          {t.dashboard.sentToGoogle}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--text-dim)' }} />
          {t.dashboard.intercepted}
        </span>
      </div>
    </div>
  );
}

/* ── Table Header ── */

function Th({ children, align, w }: { children: React.ReactNode; align: 'left' | 'right' | 'center'; w?: number }) {
  return (
    <th style={{
      textAlign: align, padding: '0.625rem 1rem', fontSize: '0.6875rem',
      fontWeight: 600, color: 'var(--text-dim)', width: w,
    }}>
      {children}
    </th>
  );
}

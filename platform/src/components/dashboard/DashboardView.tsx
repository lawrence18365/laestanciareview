'use client';

import { useMemo } from 'react';
import { downloadCSV } from '@/lib/csv';
import { t } from '@/lib/i18n';

function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MEXICO_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  day: 'numeric',
  month: 'numeric',
});

function formatDateES(d: Date): string {
  const parts = MEXICO_DATE_PARTS.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '1';
  return `${day} ${MONTHS_ES[parseInt(month, 10) - 1]}`;
}

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
  googleReviewsToday: number | null;
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
  googleReviewsToday,
}: Props) {
  const firstReview = roiStats.firstReviewAt ? new Date(roiStats.firstReviewAt) : null;
  const weeksActive = useMemo(() => {
    if (!firstReview) return 0;
    // Use a day-granularity timestamp to avoid server/client mismatch from Date.now()
    const now = new Date();
    const stableNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.max(1, Math.round((stableNow - firstReview.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roiStats.firstReviewAt]);
  const avgReviewsPerWeek = weeksActive > 0 ? (roiStats.totalReviews / weeksActive).toFixed(1) : '0';

  const googleConversionText = googleTrend && googleTrend.reviewsGained > 0
    ? t.dashboard.googleConversion(roiStats.googleSends, googleTrend.reviewsGained)
    : null;

  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="stagger-1">
        <h1 className="text-editorial" style={{ margin: '0 0 0.5rem 0' }}>
          {t.nav.dashboard}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1rem' }}>
          Resumen de rendimiento y métricas clave.
        </p>
      </div>

      {/* ── Global Empty State ── */}
      {roiStats.totalReviews === 0 && (
        <div className="card stagger-2" style={{
          padding: '4rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '0.75rem',
        }}>
          <p style={{
            margin: 0,
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}>
            ESTADO
          </p>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 600,
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-main)',
          }}>
            Aún no hay reseñas
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.9375rem',
            color: 'var(--text-muted)',
            maxWidth: 420,
            lineHeight: 1.5,
          }}>
            Las reseñas aparecerán aquí cuando los clientes escaneen los códigos NFC.
          </p>
        </div>
      )}

      {/* ── Alerts ── */}
      {unreadLowCount > 0 && (
        <a href="/inbox" className="card stagger-2" style={{
          display: 'flex', alignItems: 'center', gap: '1rem',
          padding: '1.25rem 1.5rem', textDecoration: 'none', color: 'var(--text-main)',
          borderLeft: '4px solid var(--red)',
        }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#FDF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>!</span>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem', fontFamily: 'var(--font-serif)' }}>
              {t.dashboard.negativeReviewNeedsAttention(unreadLowCount)}
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {t.dashboard.belowThreshold}
            </p>
          </div>
        </a>
      )}

      {unreadCount > 0 && unreadLowCount === 0 && (
        <a href="/inbox" className="card stagger-2" style={{
          display: 'flex', alignItems: 'center', gap: '1rem',
          padding: '1.25rem 1.5rem', textDecoration: 'none', color: 'var(--text-main)',
          borderLeft: '4px solid var(--gold)',
        }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--gold-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </span>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem', fontFamily: 'var(--font-serif)' }}>
            {t.dashboard.unreadFeedback(unreadCount)}
          </p>
        </a>
      )}

      {/* ── Impact Section ── */}
      {roiStats.totalReviews > 0 && (
        <div className="card stagger-2 impact-wrapper" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '2rem 2rem 1.5rem' }}>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
              {t.dashboard.rateTapImpact}
            </p>

            {/* Google Rating Hero */}
            {googleTrend ? (
              <div style={{ margin: '1rem 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.5rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500, fontFamily: 'var(--font-serif)' }}>
                    {googleTrend.baselineRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>&rarr;</span>
                  <span style={{ fontSize: '3.5rem', fontWeight: 600, lineHeight: 1, fontFamily: 'var(--font-serif)' }}>
                    {googleTrend.currentRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--gold)', fontSize: '2rem' }}>&#9733;</span>
                  {googleTrend.ratingChange !== 0 && (
                    <span style={{
                      padding: '4px 10px', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 600,
                      background: googleTrend.ratingChange > 0 ? 'rgba(43,98,77,0.4)' : 'rgba(155,49,49,0.4)',
                      color: googleTrend.ratingChange > 0 ? '#A7F3D0' : '#FECACA',
                    }}>
                      {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                    </span>
                  )}
                </div>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t.dashboard.googleRatingSinceStart}
                </p>
              </div>
            ) : googleRating != null ? (
              <div style={{ margin: '1rem 0 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                  <span style={{ fontSize: '3.5rem', fontWeight: 600, lineHeight: 1, fontFamily: 'var(--font-serif)' }}>
                    {googleRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--gold)', fontSize: '2rem' }}>&#9733;</span>
                  {googleReviewCount != null && (
                    <span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)', marginLeft: 8 }}>
                      {fmt(googleReviewCount)} {t.dashboard.googleReviews}
                    </span>
                  )}
                </div>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t.dashboard.currentGoogleRating}
                </p>
              </div>
            ) : null}
          </div>

          {/* Impact metrics row */}
          <div className="grid-impact" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <ImpactMetric
              label={t.dashboard.sentToGoogle}
              value={roiStats.googleSends}
              sub={googleTrend && googleTrend.reviewsGained > 0
                ? t.dashboard.newGoogleReviewsConfirmed(googleTrend.reviewsGained)
                : t.dashboard.customersDirectedToGoogle}
            />
            <ImpactMetric
              label={t.dashboard.badReviewsPrevented}
              value={roiStats.intercepted}
              sub={t.dashboard.negativeReviewsCaughtPrivately}
              href="/inbox"
            />
            <ImpactMetric
              label={t.dashboard.reviewVelocity}
              value={avgReviewsPerWeek}
              valueSuffix="/sem"
              sub={t.dashboard.totalOverWeeks(roiStats.totalReviews, weeksActive)}
            />
          </div>

          {googleConversionText && (
            <div style={{ padding: '1rem 2rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
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
          footnote={
            googleReviewsToday != null
              ? `Google hoy: +${googleReviewsToday}`
              : null
          }
        />
      </div>

      {/* ── Charts ── */}
      <div className="grid-charts stagger-4">
        {googleHistory.length >= 2 && (
          <section className="card" style={{ padding: '1.5rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 1.25rem', fontFamily: 'var(--font-serif)' }}>
              {t.dashboard.googleRatingOverTime}
            </h1>
            <GoogleRatingChart snapshots={googleHistory} />
          </section>
        )}

        {monthlyStats.length >= 2 ? (
          <section className="card" style={{ padding: '1.5rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 1.25rem', fontFamily: 'var(--font-serif)' }}>
              {t.dashboard.monthlyTrend}
            </h1>
            <MonthlyChart data={monthlyStats} />
          </section>
        ) : roiStats.totalReviews > 0 ? (
          <section className="card" style={{ padding: '1.5rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)', margin: '0 0 1.25rem', fontFamily: 'var(--font-serif)' }}>
              {t.dashboard.monthlyTrend}
            </h1>
            <div style={{ padding: '2.5rem 1rem', textAlign: 'center' }}>
              <p style={{
                margin: 0,
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: '0.5rem',
              }}>
                EN PROGRESO
              </p>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Se necesitan al menos 2 meses de datos para mostrar la tendencia.
              </p>
            </div>
          </section>
        ) : null}
      </div>

      {/* ── Leaderboard ── */}
      <section className="card stagger-5" style={{ overflow: 'hidden' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--panel-border)',
        }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-main)', margin: 0, fontFamily: 'var(--font-serif)' }}>
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
              style={{ fontSize: '0.8125rem', padding: '0.4rem 1rem' }}
            >
              {t.dashboard.exportCsv}
            </button>
          )}
        </div>

        {leaderboard.length === 0 ? (
          <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
            <p style={{
              margin: 0,
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-dim)',
              marginBottom: '0.5rem',
            }}>
              ACTIVIDAD SEMANAL
            </p>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9375rem', fontFamily: 'var(--font-serif)' }}>
              Sin actividad esta semana
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base)' }}>
                  <Th align="center" w={60}>{t.dashboard.rank}</Th>
                  <Th align="left">{t.dashboard.staffCol}</Th>
                  <Th align="right">{t.dashboard.avgRatingCol}</Th>
                  <Th align="right">{t.dashboard.reviewsCol}</Th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr key={entry.staffId ?? i} style={{ borderTop: '1px solid var(--panel-border)' }}>
                    <td style={{ textAlign: 'center', padding: '1rem 1.5rem', fontSize: '0.875rem', color: 'var(--text-dim)', fontWeight: 500 }}>
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9375rem' }}>
                      <span style={{ fontWeight: 500 }}>{entry.staffName ?? t.dashboard.unknown}</span>
                      {entry.staffCode && (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 12, fontSize: '0.8125rem' }}>
                          {entry.staffCode}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', fontWeight: 600 }}>
                      {entry.avgRating.toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', color: 'var(--text-muted)' }}>
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

function ImpactMetric({ label, value, valueSuffix, sub, href }: {
  label: string;
  value: string | number;
  valueSuffix?: string;
  sub: string;
  href?: string;
}) {
  const content = (
    <>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '2rem', fontWeight: 600, color: '#fff', lineHeight: 1, fontFamily: 'var(--font-serif)' }}>
        {value}
        {valueSuffix && <span style={{ fontSize: '1rem', fontWeight: 400, color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>{valueSuffix}</span>}
      </p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.6)' }}>
        {sub}
      </p>
    </>
  );

  if (href) {
    return (
      <a href={href} className="impact-metric-item" style={{ textDecoration: 'none', color: 'inherit' }}>
        {content}
      </a>
    );
  }

  return <div className="impact-metric-item">{content}</div>;
}

/* ── Stat Card ── */

function StatCard({
  label, value, suffix, delta, deltaLabel, footnote,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: number | null;
  deltaLabel?: string;
  footnote?: string | null;
}) {
  const showDelta = delta != null && delta !== 0;
  const positive = delta != null && delta > 0;

  return (
    <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-main)', lineHeight: 1, fontFamily: 'var(--font-serif)' }}>
        {value}
        {suffix && <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--text-dim)', marginLeft: 6, fontFamily: 'var(--font-sans)' }}>{suffix}</span>}
      </p>
      {showDelta && (
        <p style={{ margin: 0, fontSize: '0.875rem', color: positive ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
          {positive ? '+' : ''}{delta} {deltaLabel}
        </p>
      )}
      {!showDelta && (
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-dim)' }}>
          esta semana
        </p>
      )}
      {footnote && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600 }}>
          {footnote}
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
  const H = 180;
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
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', minWidth: 400 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + plotH * (1 - frac);
          const val = (minR + range * frac).toFixed(1);
          return (
            <g key={frac}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--panel-border)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={padX - 10} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-dim)">{val}</text>
            </g>
          );
        })}

        <path d={areaPath} fill="rgba(43,98,77,0.06)" />
        <path d={linePath} fill="none" stroke="var(--green)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={first.x} cy={first.y} r={4.5} fill="var(--panel-bg)" stroke="var(--green)" strokeWidth={2.5} />
        <circle cx={last.x} cy={last.y} r={5} fill="var(--green)" />

        <text x={first.x} y={first.y - 14} textAnchor="start" fontSize={12} fontWeight={600} fill="var(--text-main)">{first.rating.toFixed(1)}</text>
        <text x={last.x} y={last.y - 14} textAnchor="end" fontSize={13} fontWeight={700} fill="var(--text-main)">{last.rating.toFixed(1)}</text>

        <text x={padX} y={H - 2} fontSize={11} fill="var(--text-dim)" textAnchor="start">
          {formatDateES(firstDate)}
        </text>
        <text x={W - padX} y={H - 2} textAnchor="end" fontSize={11} fill="var(--text-dim)">
          {formatDateES(lastDate)}
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
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, minHeight: 140, minWidth: data.length * 50, padding: '0 0.5rem' }}>
        {data.map((d) => {
          const [, month] = d.month.split('-');
          const label = MONTHS_ES[parseInt(month) - 1];
          return (
            <div key={d.month} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>{d.reviewCount}</span>
              <div style={{ display: 'flex', width: '100%', overflow: 'hidden', flexDirection: 'column-reverse', background: 'var(--bg-base)' }}>
                <div
                  style={{
                    height: Math.max((d.googleSends / maxCount) * 110, d.googleSends > 0 ? 4 : 0),
                    background: 'var(--text-main)',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.googleSends} ${t.dashboard.sentToGoogleChart}`}
                />
                <div
                  style={{
                    height: Math.max((d.intercepted / maxCount) * 110, d.intercepted > 0 ? 4 : 0),
                    background: 'var(--text-dim)',
                    transition: 'height 0.3s',
                  }}
                  title={`${d.intercepted} ${t.dashboard.interceptedChart}`}
                />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.5rem', fontSize: '0.8125rem', color: 'var(--text-dim)', justifyContent: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--text-main)' }} />
          {t.dashboard.sentToGoogle}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--text-dim)' }} />
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
      textAlign: align, padding: '0.875rem 1.5rem', fontSize: '0.8125rem',
      fontWeight: 600, color: 'var(--text-dim)', width: w, textTransform: 'uppercase', letterSpacing: '0.04em'
    }}>
      {children}
    </th>
  );
}

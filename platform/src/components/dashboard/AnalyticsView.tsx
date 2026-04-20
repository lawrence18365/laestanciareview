'use client';

import { downloadCSV } from '@/lib/csv';
import { t } from '@/lib/i18n';

/* ── Types ── */

interface ROIStats {
  totalReviews: number;
  avgRating: number;
  googleSends: number;
  intercepted: number;
  feedbackCount: number;
  firstReviewAt: Date | string | null;
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

interface Props {
  weeklyStats: { totalReviews: number; avgRating: number; googleSends: number };
  allTimeStats: {
    totalReviews: number;
    avgRating: number;
    googleSends: number;
    feedbackCount: number;
  };
  dailyCounts: { date: string; count: number; avgRating: number }[];
  conversion: { rate: number; above: number; sent: number };
  staffRanking: {
    staffId: number | null;
    staffName: string | null;
    staffCode: string | null;
    reviewCount: number;
    avgRating: number;
    fiveStarCount: number;
    belowFourCount: number;
  }[];
  roiStats: ROIStats;
  googleTrend: GoogleTrend | null;
}

/* ── Main Component ── */

export default function AnalyticsView({
  weeklyStats,
  allTimeStats,
  dailyCounts,
  conversion,
  staffRanking,
  roiStats,
  googleTrend,
}: Props) {

  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="stagger-1">
        <h1 className="text-editorial" style={{ margin: '0 0 0.5rem 0' }}>
          {t.nav.analytics}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1rem' }}>
          Métricas detalladas y análisis de rendimiento.
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
            ANALÍTICAS
          </p>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 600,
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-main)',
          }}>
            Aún no hay datos de analíticas
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.9375rem',
            color: 'var(--text-muted)',
            maxWidth: 420,
            lineHeight: 1.5,
          }}>
            Los datos aparecerán aquí conforme los clientes interactúen con los códigos NFC.
          </p>
        </div>
      )}

      {/* ── Impact Summary Banner ── */}
      {roiStats.totalReviews > 0 && (
        <div className="card stagger-2 impact-wrapper" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '2rem 2rem 1.5rem' }}>
            {googleTrend && googleTrend.ratingChange !== 0 ? (
              <>
                <p className="section-label" style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 0.5rem' }}>
                  {t.analytics.googleRating}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.5rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500, fontFamily: 'var(--font-serif)' }}>
                    {googleTrend.baselineRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>&rarr;</span>
                  <span className="editorial-serif" style={{ fontSize: '3.5rem', fontWeight: 600, lineHeight: 1 }}>
                    {googleTrend.currentRating.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--gold)', fontSize: '2rem' }}>&#9733;</span>
                  <span style={{
                    padding: '4px 10px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: googleTrend.ratingChange > 0 ? 'rgba(43,98,77,0.4)' : 'rgba(155,49,49,0.4)',
                    color: googleTrend.ratingChange > 0 ? '#A7F3D0' : '#FECACA',
                  }}>
                    {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="section-label" style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 0.5rem' }}>
                  {t.analytics.allTimeImpact}
                </p>
                <p className="editorial-serif" style={{ margin: 0, fontSize: '3.5rem', fontWeight: 600, lineHeight: 1 }}>
                  {roiStats.totalReviews} <span style={{ fontSize: '1.5rem', fontWeight: 400, color: 'rgba(255,255,255,0.6)' }}>{t.analytics.scans}</span>
                </p>
              </>
            )}
          </div>

          {/* Impact metrics row */}
          <div className="grid-impact" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <ImpactMetric
              label={t.analytics.sentToGoogle}
              value={roiStats.googleSends}
              sub={googleTrend && googleTrend.reviewsGained > 0
                ? t.analytics.confirmedNewReviews(googleTrend.reviewsGained)
                : t.analytics.customersDirectedToGoogle}
            />
            <ImpactMetric
              label={t.analytics.intercepted}
              value={roiStats.intercepted}
              sub={t.analytics.badReviewsCaughtPrivately}
            />
          </div>
        </div>
      )}

      {/* ── Overview Cards ── */}
      {roiStats.totalReviews > 0 && <div className="grid-stats stagger-3">
        <MiniCard label={t.analytics.allTimeReviews} value={allTimeStats.totalReviews} />
        <MiniCard
          label={t.analytics.allTimeAvg}
          value={allTimeStats.avgRating ? allTimeStats.avgRating.toFixed(1) : '--'}
          suffix=" / 5"
        />
        <MiniCard label={t.analytics.googleSends} value={allTimeStats.googleSends} />
        <MiniCard label={t.analytics.feedbackReceived} value={allTimeStats.feedbackCount} />
        <MiniCard label={t.analytics.thisWeek} value={weeklyStats.totalReviews} />
        <MiniCard
          label={t.analytics.googleConversion}
          value={`${conversion.rate}%`}
          sub={t.analytics.ofEligible(conversion.sent, conversion.above)}
        />
      </div>}

      {/* ── Ranking de Personal (all-time) ── */}
      {roiStats.totalReviews > 0 && <section className="card stagger-4" style={{ overflow: 'hidden' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--panel-border)',
        }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, fontFamily: 'var(--font-serif)', color: 'var(--text-main)' }}>
            Ranking de Personal
          </h2>
          {staffRanking.length > 0 && (
            <button
              className="btn btn-outline"
              onClick={() =>
                downloadCSV(
                  staffRanking.map((s, i) => ({
                    Rango: i + 1,
                    Personal: s.staffName ?? s.staffCode ?? 'Desconocido',
                    Código: s.staffCode ?? '',
                    Reseñas: s.reviewCount,
                    '5 Estrellas': s.fiveStarCount,
                    'Menos de 4': s.belowFourCount,
                    'Calif. Prom.': s.avgRating ? s.avgRating.toFixed(1) : '',
                  })),
                  'ranking-personal.csv',
                )
              }
              style={{ fontSize: '0.8125rem', padding: '0.4rem 1rem' }}
            >
              {t.analytics.exportCsv}
            </button>
          )}
        </div>
        {staffRanking.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', textAlign: 'center', padding: '3rem 0', margin: 0 }}>
            {t.analytics.noReviewsThisWeek}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base)' }}>
                  <Th align="center" w={60}>#</Th>
                  <Th align="left">Personal</Th>
                  <Th align="right">Reseñas</Th>
                  <Th align="right">5 ★</Th>
                  <Th align="right">&lt; 4 ★</Th>
                  <Th align="right">Prom.</Th>
                </tr>
              </thead>
              <tbody>
                {staffRanking.map((entry, i) => (
                  <tr key={entry.staffId ?? `${entry.staffCode}-${i}`} style={{ borderTop: '1px solid var(--panel-border)' }}>
                    <td style={{ textAlign: 'center', padding: '1rem 1.5rem', fontSize: '0.875rem', color: 'var(--text-dim)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9375rem' }}>
                      <span style={{ fontWeight: 500 }}>{entry.staffName ?? 'Desconocido'}</span>
                      {entry.staffCode && (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 12, fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>
                          {entry.staffCode}
                        </span>
                      )}
                    </td>
                    <td className="font-numeric" style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', fontWeight: 600 }}>
                      {entry.reviewCount}
                    </td>
                    <td className="font-numeric" style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', color: entry.fiveStarCount > 0 ? 'var(--text-main)' : 'var(--text-dim)' }}>
                      {entry.fiveStarCount}
                    </td>
                    <td className="font-numeric" style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', color: entry.belowFourCount > 0 ? 'var(--text-main)' : 'var(--text-dim)' }}>
                      {entry.belowFourCount}
                    </td>
                    <td className="font-numeric" style={{ textAlign: 'right', padding: '1rem 1.5rem', fontSize: '0.9375rem', color: 'var(--text-muted)' }}>
                      {entry.avgRating ? entry.avgRating.toFixed(1) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {/* ── Daily Activity ── */}
      {roiStats.totalReviews > 0 && <section className="card stagger-4" style={{ overflow: 'hidden' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--panel-border)',
        }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, fontFamily: 'var(--font-serif)', color: 'var(--text-main)' }}>
            {t.analytics.dailyReviews}
          </h2>
          {dailyCounts.length > 0 && (
            <button
              className="btn btn-outline"
              onClick={() =>
                downloadCSV(
                  dailyCounts.map((d) => ({
                    Fecha: d.date,
                    Reseñas: d.count,
                    'Calif. Prom.': d.avgRating?.toFixed(1) ?? '',
                  })),
                  'resenas-diarias.csv',
                )
              }
              style={{ fontSize: '0.8125rem', padding: '0.4rem 1rem' }}
            >
              {t.analytics.exportCsv}
            </button>
          )}
        </div>
        <div style={{ padding: '1.5rem' }}>
          {dailyCounts.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0', margin: 0 }}>
              {t.analytics.noReviewsLast30}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 3,
                  height: 140,
                  minWidth: dailyCounts.length * 20,
                  padding: '0 0.25rem',
                }}
              >
                {dailyCounts.map((d) => {
                  const maxCount = Math.max(...dailyCounts.map((x) => x.count), 1);
                  const h = (d.count / maxCount) * 120;
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.count} reseñas, prom. ${d.avgRating?.toFixed(1) ?? '--'}`}
                      style={{
                        flex: 1,
                        minWidth: 14,
                        maxWidth: 32,
                        height: Math.max(h, 3),
                        background:
                          d.avgRating >= 4
                            ? 'var(--green)'
                            : d.avgRating >= 3
                              ? 'var(--gold)'
                              : 'var(--red)',
                        opacity: 0.8,
                        cursor: 'default',
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                    />
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>{dailyCounts[0]?.date}</span>
                <span>{dailyCounts[dailyCounts.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>
      </section>}

    </div>
  );
}

/* ── Impact Metric ── */

function ImpactMetric({ label, value, sub }: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="impact-metric-item">
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p className="editorial-serif" style={{ margin: 0, fontSize: '2rem', fontWeight: 600, color: '#fff', lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.6)' }}>
        {sub}
      </p>
    </div>
  );
}

/* ── Mini Card ── */

function MiniCard({
  label,
  value,
  suffix,
  sub,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <p style={{
        margin: 0,
        fontSize: '0.875rem',
        fontWeight: 500,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label}
      </p>
      <p className="editorial-serif" style={{
        margin: 0,
        fontSize: '2.5rem',
        fontWeight: 600,
        color: 'var(--text-main)',
        lineHeight: 1,
      }}>
        {value}
        {suffix && (
          <span style={{ fontSize: '1rem', fontWeight: 400, color: 'var(--text-dim)', marginLeft: 6, fontFamily: 'var(--font-sans)' }}>
            {suffix}
          </span>
        )}
      </p>
      {sub && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ── Table Header ── */

function Th({ children, align, w }: { children: React.ReactNode; align: 'left' | 'right' | 'center'; w?: number }) {
  return (
    <th style={{
      textAlign: align,
      padding: '0.875rem 1.5rem',
      fontSize: '0.8125rem',
      fontWeight: 600,
      color: 'var(--text-dim)',
      width: w,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {children}
    </th>
  );
}

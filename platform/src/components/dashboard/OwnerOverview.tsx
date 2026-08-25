'use client';

import { useState, useMemo, useEffect } from 'react';
import { getBrandForSlug } from '@/lib/brands';
import { t } from '@/lib/i18n';

function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ── Types ── */

interface RestaurantStats {
  restaurantId: number;
  restaurantName: string;
  slug: string;
  weeklyReviews: number;
  weeklyAvg: number | null;
  weeklyGoogle: number;
  totalReviews: number;
  totalAvg: number | null;
}

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

interface WeeklyHistoryRow {
  weekStart: string;
  reviewCount: number;
  avgRating: number | null;
  googleSends: number;
  intercepted: number;
}

interface WeeklyByRestaurantRow {
  restaurantId: number;
  restaurantName: string;
  slug: string;
  weekStart: string;
  reviewCount: number;
  avgRating: number | null;
  googleSends: number;
  intercepted: number;
}

interface Props {
  stats: RestaurantStats[];
  unresolvedCounts: Record<number, number>;
  roiByLocation: Record<number, ROIStats>;
  googleTrends: Record<number, GoogleTrend | null>;
  weeklyHistory?: WeeklyHistoryRow[];
  baselineTotal?: number;
  weeklyByRestaurant?: WeeklyByRestaurantRow[];
}

type SortKey = 'restaurantName' | 'weeklyReviews' | 'weeklyAvg' | 'totalReviews' | 'totalAvg' | 'unresolved' | 'roi' | 'ratingChange';

/* ── Main Component ── */

export default function OwnerOverview({ stats, unresolvedCounts, roiByLocation, googleTrends, weeklyHistory = [], baselineTotal = 0, weeklyByRestaurant = [] }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('roi');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const portfolioROI = useMemo(() => {
    let totalGoogleSends = 0;
    let totalIntercepted = 0;
    let totalReviews = 0;
    let totalRatingGain = 0;
    let totalReviewsGained = 0;
    let locationsWithGain = 0;

    for (const r of stats) {
      const roi = roiByLocation[r.restaurantId];
      if (roi) {
        totalGoogleSends += roi.googleSends;
        totalIntercepted += roi.intercepted;
        totalReviews += roi.totalReviews;
      }
      const trend = googleTrends[r.restaurantId];
      if (trend && trend.ratingChange > 0) {
        totalRatingGain += trend.ratingChange;
        locationsWithGain++;
      }
      if (trend && trend.reviewsGained > 0) {
        totalReviewsGained += trend.reviewsGained;
      }
    }

    return {
      totalGoogleSends,
      totalIntercepted,
      totalReviews,
      totalReviewsGained,
      avgRatingGain: locationsWithGain > 0 ? totalRatingGain / locationsWithGain : 0,
      locationsWithGain,
    };
  }, [stats, roiByLocation, googleTrends]);

  const statsWithExtras = useMemo(
    () =>
      stats.map((r) => {
        const roi = roiByLocation[r.restaurantId];
        const trend = googleTrends[r.restaurantId];
        const roiValue = roi ? roi.googleSends + roi.intercepted : 0;
        return {
          ...r,
          unresolved: unresolvedCounts[r.restaurantId] ?? 0,
          roi: roiValue,
          googleSends: roi?.googleSends ?? 0,
          intercepted: roi?.intercepted ?? 0,
          ratingChange: trend?.ratingChange ?? 0,
          currentRating: trend?.currentRating ?? null,
          baselineRating: trend?.baselineRating ?? null,
          reviewsGained: trend?.reviewsGained ?? 0,
        };
      }),
    [stats, unresolvedCounts, roiByLocation, googleTrends],
  );

  const sorted = useMemo(() => {
    return [...statsWithExtras].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [statsWithExtras, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'restaurantName' ? 'asc' : 'desc');
    }
  }

  const totalWeekly = stats.reduce((s, r) => s + r.weeklyReviews, 0);
  const totalUnresolved = Object.values(unresolvedCounts).reduce((s, c) => s + c, 0);

  if (stats.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-dark)',
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
            RESUMEN DE PORTAFOLIO
          </p>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 600,
            fontFamily: 'var(--font-serif)',
            color: 'var(--text-main)',
          }}>
            No hay restaurantes registrados
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.9375rem',
            color: 'var(--text-muted)',
            maxWidth: 420,
            lineHeight: 1.5,
          }}>
            Las ubicaciones aparecerán aquí una vez que se agreguen al sistema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* ── PORTFOLIO SUMMARY ── */}
      <div
        style={{
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-dark)',
          padding: '1.75rem 2rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: '#D97706',
          }}
        />

        <div
          style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#D97706',
            marginBottom: '1.5rem',
          }}
        >
          {t.owner.portfolioImpact(stats.length)}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {/* Google Sends */}
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
              {t.owner.sentToGoogle}
            </div>
            <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--green)', lineHeight: 1 }}>
              {fmt(portfolioROI.totalGoogleSends)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              {portfolioROI.totalReviewsGained > 0
                ? t.owner.newGoogleReviewsConfirmed(portfolioROI.totalReviewsGained)
                : t.owner.customersDirectedToGoogle}
            </div>
          </div>

          {/* Intercepted */}
          <a href="/intercepted" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
              {t.owner.badReviewsPrevented}
            </div>
            <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--gold)', lineHeight: 1 }}>
              {fmt(portfolioROI.totalIntercepted)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              {t.owner.negativeReviewsCaughtPrivately}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--gold)', marginTop: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.owner.viewDetails} &rarr;
            </div>
          </a>

          {/* Total Scans */}
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
              {t.owner.totalScans}
            </div>
            <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
              {fmt(portfolioROI.totalReviews)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              {t.owner.thisWeek(totalWeekly)}
            </div>
          </div>

          {/* Google Rating Change */}
          {portfolioROI.locationsWithGain > 0 && (
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                Google &#9733;
              </div>
              <div className="font-numeric" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--green)', lineHeight: 1 }}>
                +{portfolioROI.avgRatingGain.toFixed(1)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
                {t.owner.avgGoogleRatingGain(portfolioROI.locationsWithGain)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Unresolved alert ── */}
      {totalUnresolved > 0 && (
        <div
          style={{
            padding: '1rem 1.25rem',
            border: '1px solid var(--red)',
            background: 'var(--red-light)',
            color: 'var(--red)',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          {t.owner.unresolvedFeedback(totalUnresolved)}
        </div>
      )}

      {/* ── Weekly History ── */}
      {weeklyHistory.length > 0 && (
        <WeeklyHistorySection rows={weeklyHistory} baselineTotal={baselineTotal} />
      )}

      {/* ── Per-Unit Effectiveness ── */}
      {weeklyByRestaurant.length > 0 && (
        <PerUnitEffectivenessSection rows={weeklyByRestaurant} roiByLocation={roiByLocation} stats={stats} />
      )}

      {/* ── Location Table / Cards ── */}
      <section style={{
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-dark)',
        padding: '1.5rem',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '1.1rem',
          fontWeight: 600,
          color: 'var(--text-main)',
          margin: '0 0 1rem',
        }}>
          {t.owner.allLocations}
        </h2>

        {/* ── Mobile Card Layout ── */}
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {sorted.map((r) => {
              const brand = getBrandForSlug(r.slug);
              return (
                <div
                  key={r.restaurantId}
                  style={{
                    border: '1px solid var(--border-dark)',
                    padding: '1rem',
                    background: 'var(--bg-base)',
                  }}
                >
                  {/* Card header: logo + name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        overflow: 'hidden',
                        background: brand.darkBg ? '#000' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        border: '1px solid var(--border-dark)',
                      }}
                    >
                      <img
                        src={brand.logo}
                        alt={r.restaurantName}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 2 }}
                      />
                    </div>
                    <a
                      href={`/dashboard?slug=${r.slug}`}
                      style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)', textDecoration: 'none' }}
                    >
                      {r.restaurantName}
                    </a>
                  </div>

                  {/* Card stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                    {/* Google Rating */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                        {t.owner.googleStar}
                      </div>
                      {r.currentRating != null ? (
                        <div>
                          <span className="font-numeric" style={{ fontWeight: 600, fontSize: '1rem' }}>{r.currentRating.toFixed(1)}</span>
                          <span style={{ color: 'var(--gold)', marginLeft: 2 }}>&#9733;</span>
                          {r.ratingChange !== 0 && (
                            <span
                              className="font-numeric"
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: r.ratingChange > 0 ? 'var(--green)' : 'var(--red)',
                                marginLeft: 4,
                              }}
                            >
                              {r.ratingChange > 0 ? '+' : ''}{r.ratingChange.toFixed(1)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>--</span>
                      )}
                    </div>

                    {/* Weekly Reviews */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                        {t.owner.weekly}
                      </div>
                      <span className="font-numeric" style={{ fontWeight: 600, fontSize: '1rem' }}>{r.weeklyReviews}</span>
                      {r.weeklyAvg != null && (
                        <span className="font-numeric" style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: 4 }}>
                          ({Number(r.weeklyAvg).toFixed(1)} {t.owner.avg})
                        </span>
                      )}
                    </div>

                    {/* Impact */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                        {t.owner.impact}
                      </div>
                      <span className="font-numeric" style={{ fontWeight: 700, color: 'var(--green)' }}>{r.googleSends}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 3px' }}>/</span>
                      <span className="font-numeric" style={{ fontWeight: 700, color: 'var(--gold)' }}>{r.intercepted}</span>
                      <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {t.owner.sentCaught}
                      </div>
                    </div>

                    {/* Unresolved */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                        {t.owner.unresolved}
                      </div>
                      {r.unresolved > 0 ? (
                        <span className="font-numeric" style={{ color: 'var(--red)', fontWeight: 700, fontSize: '1rem' }}>{r.unresolved}</span>
                      ) : (
                        <span className="font-numeric" style={{ color: 'var(--green)', fontSize: '1rem' }}>0</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Desktop Table Layout ── */
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <SortTh label={t.owner.restaurant} sortKey="restaurantName" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label={t.owner.impact} sortKey="roi" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t.owner.googleStar} sortKey="ratingChange" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t.owner.weekly} sortKey="weeklyReviews" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t.owner.unresolved} sortKey="unresolved" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t.owner.total} sortKey="totalReviews" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const brand = getBrandForSlug(r.slug);
                  return (
                    <tr key={r.restaurantId} style={{ borderTop: '1px solid var(--panel-border)' }}>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              overflow: 'hidden',
                              background: brand.darkBg ? '#000' : '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              border: '1px solid var(--border-dark)',
                            }}
                          >
                            <img
                              src={brand.logo}
                              alt={r.restaurantName}
                              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 2 }}
                            />
                          </div>
                          <a
                            href={`/dashboard?slug=${r.slug}`}
                            style={{ fontWeight: 500, fontSize: '0.9rem', color: 'inherit', textDecoration: 'none' }}
                          >
                            {r.restaurantName}
                          </a>
                        </div>
                      </td>

                      <TdCell align="right">
                        <span className="font-numeric" style={{ fontWeight: 700, color: 'var(--green)' }}>
                          {r.googleSends}
                        </span>
                        <span style={{ color: 'var(--text-dim)', margin: '0 3px' }}>/</span>
                        <span className="font-numeric" style={{ fontWeight: 700, color: 'var(--gold)' }}>
                          {r.intercepted}
                        </span>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', marginTop: 1, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {t.owner.sentCaught}
                        </div>
                      </TdCell>

                      <TdCell align="right">
                        {r.currentRating != null ? (
                          <div>
                            <span className="font-numeric" style={{ fontWeight: 600 }}>{r.currentRating.toFixed(1)}</span>
                            <span style={{ color: 'var(--gold)', marginLeft: 2 }}>&#9733;</span>
                            {r.ratingChange !== 0 && (
                              <div
                                className="font-numeric"
                                style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  color: r.ratingChange > 0 ? 'var(--green)' : 'var(--red)',
                                  marginTop: 1,
                                }}
                              >
                                {r.ratingChange > 0 ? '+' : ''}{r.ratingChange.toFixed(1)}
                                {r.reviewsGained > 0 && (
                                  <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                                    {' '}(+{r.reviewsGained})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>--</span>
                        )}
                      </TdCell>

                      <TdCell align="right">
                        <span className="font-numeric">{r.weeklyReviews}</span>
                        {r.weeklyAvg != null && (
                          <div className="font-numeric" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            {Number(r.weeklyAvg).toFixed(1)} {t.owner.avg}
                          </div>
                        )}
                      </TdCell>

                      <TdCell align="right">
                        {r.unresolved > 0 ? (
                          <span
                            className="font-numeric"
                            style={{
                              color: 'var(--red)',
                              fontWeight: 700,
                              background: 'var(--red-light, rgba(220, 38, 38, 0.08))',
                              padding: '2px 6px',
                              fontSize: '0.95rem',
                            }}
                            title={`${r.restaurantName}: ${r.unresolved} con estado Nuevo`}
                          >
                            {r.unresolved}
                          </span>
                        ) : (
                          <span className="font-numeric" style={{ color: 'var(--green)' }}>0</span>
                        )}
                      </TdCell>

                      <TdCell align="right">
                        <span className="font-numeric">{r.totalReviews}</span>
                      </TdCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Weekly History Section ── */

function formatWeekRange(weekStartStr: string): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(d);
  end.setDate(end.getDate() + 6);

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  if (d.getMonth() === end.getMonth()) {
    return `${d.getDate()}–${end.getDate()} ${months[d.getMonth()]}`;
  }
  return `${d.getDate()} ${months[d.getMonth()]}–${end.getDate()} ${months[end.getMonth()]}`;
}

function isCurrentWeek(weekStartStr: string): boolean {
  const ws = new Date(weekStartStr + 'T00:00:00');
  const now = new Date();
  // Monday of current week
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  return ws.getTime() === monday.getTime();
}

function WeeklyHistorySection({ rows, baselineTotal }: { rows: WeeklyHistoryRow[]; baselineTotal: number }) {
  // Build cumulative totals (rows are ordered oldest → newest)
  const withCumulative = useMemo(() => {
    return rows.reduce<(WeeklyHistoryRow & { cumulative: number })[]>((acc, r) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : baselineTotal;
      acc.push({ ...r, cumulative: prev + r.reviewCount });
      return acc;
    }, []);
  }, [rows, baselineTotal]);

  // Display newest first
  const display = [...withCumulative].reverse();
  const grandTotal = display[0]?.cumulative ?? baselineTotal;

  return (
    <section style={{
      background: 'var(--panel-bg)',
      border: '1px solid var(--border-dark)',
      padding: '1.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.1rem',
            fontWeight: 600,
            color: 'var(--text-main)',
            margin: 0,
          }}>
            {t.owner.weeklyHistory}
          </h2>
          <p style={{
            fontSize: '0.75rem',
            color: 'var(--text-dim)',
            margin: '0.25rem 0 0',
          }}>
            {t.owner.weeklyHistorySubtitle}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {t.owner.cumulative}
          </div>
          <div className="font-numeric" style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1 }}>
            {fmt(grandTotal)}
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle('left')}>{t.owner.week}</th>
              <th style={thStyle('right')}>{t.owner.surveys}</th>
              <th style={thStyle('right')}>{t.owner.avgShort}</th>
              <th style={thStyle('right')}>{t.owner.sentToGoogleShort}</th>
              <th style={thStyle('right')}>{t.owner.interceptedShort}</th>
              <th style={thStyle('right')}>{t.owner.cumulative}</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r) => {
              const current = isCurrentWeek(r.weekStart);
              return (
                <tr key={r.weekStart} style={{
                  borderTop: '1px solid var(--panel-border)',
                  background: current ? 'rgba(217, 119, 6, 0.04)' : undefined,
                }}>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {formatWeekRange(r.weekStart)}
                    {current && (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 700,
                        color: '#D97706',
                        marginLeft: 6,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        {t.owner.currentWeek}
                      </span>
                    )}
                  </td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric" style={{ fontWeight: 600 }}>{r.reviewCount}</span>
                  </td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric" style={{ color: 'var(--text-dim)' }}>
                      {r.avgRating != null ? Number(r.avgRating).toFixed(1) : '–'}
                    </span>
                  </td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric" style={{ color: 'var(--green)', fontWeight: 600 }}>{r.googleSends}</span>
                  </td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric" style={{ color: 'var(--gold)', fontWeight: 600 }}>{r.intercepted}</span>
                  </td>
                  <td style={tdNumStyle}>
                    <span className="font-numeric" style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{fmt(r.cumulative)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Per-Unit Effectiveness Section ── */

function PerUnitEffectivenessSection({
  rows,
  roiByLocation,
  stats,
}: {
  rows: WeeklyByRestaurantRow[];
  roiByLocation: Record<number, ROIStats>;
  stats: RestaurantStats[];
}) {
  // Collect all unique weeks (sorted newest first for display)
  const allWeeks = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.weekStart);
    return [...set].sort().reverse();
  }, [rows]);

  // Show last 8 weeks max to keep the table readable
  const displayWeeks = allWeeks.slice(0, 8);

  // Build a map: restaurantId → { weekStart → row }
  const dataMap = useMemo(() => {
    const map: Record<number, Record<string, WeeklyByRestaurantRow>> = {};
    for (const r of rows) {
      if (!map[r.restaurantId]) map[r.restaurantId] = {};
      map[r.restaurantId][r.weekStart] = r;
    }
    return map;
  }, [rows]);

  // Build restaurant list sorted by total weekly reviews (highest first)
  const restaurantList = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; slug: string; totalInWindow: number }>();
    for (const r of rows) {
      const existing = seen.get(r.restaurantId);
      if (existing) {
        existing.totalInWindow += r.reviewCount;
      } else {
        seen.set(r.restaurantId, {
          id: r.restaurantId,
          name: r.restaurantName,
          slug: r.slug,
          totalInWindow: r.reviewCount,
        });
      }
    }
    // Include restaurants with 0 reviews in the window
    for (const s of stats) {
      if (!seen.has(s.restaurantId)) {
        seen.set(s.restaurantId, {
          id: s.restaurantId,
          name: s.restaurantName,
          slug: s.slug,
          totalInWindow: 0,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, stats]);

  return (
    <section style={{
      background: 'var(--panel-bg)',
      border: '1px solid var(--border-dark)',
      padding: '1.5rem',
    }}>
      <h2 style={{
        fontFamily: 'var(--font-serif)',
        fontSize: '1.1rem',
        fontWeight: 600,
        color: 'var(--text-main)',
        margin: 0,
      }}>
        {t.owner.effectivenessPerUnit}
      </h2>
      <p style={{
        fontSize: '0.75rem',
        color: 'var(--text-dim)',
        margin: '0.25rem 0 1rem',
      }}>
        {t.owner.effectivenessSubtitle}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{
                ...thStyle('left'),
                position: 'sticky',
                left: 0,
                background: 'var(--panel-bg)',
                zIndex: 1,
                minWidth: 140,
              }}>
                {t.owner.unit}
              </th>
              {displayWeeks.map((w) => (
                <th key={w} style={{ ...thStyle('center' as 'right'), textAlign: 'center', minWidth: 70 }}>
                  {formatWeekShort(w)}
                  {isCurrentWeek(w) && (
                    <div style={{ color: '#D97706', fontSize: '0.5rem', marginTop: 1 }}>
                      {t.owner.currentWeek}
                    </div>
                  )}
                </th>
              ))}
              <th style={thStyle('right')}>{t.owner.cumulative}</th>
            </tr>
          </thead>
          <tbody>
            {restaurantList.map((rest) => {
              const roi = roiByLocation[rest.id];
              const cumulative = roi?.totalReviews ?? 0;
              const brand = getBrandForSlug(rest.slug);

              return (
                <tr key={rest.id} style={{ borderTop: '1px solid var(--panel-border)' }}>
                  <td style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--panel-bg)',
                    zIndex: 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{
                        width: 20,
                        height: 20,
                        overflow: 'hidden',
                        background: brand.darkBg ? '#000' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        border: '1px solid var(--border-dark)',
                      }}>
                        <img
                          src={brand.logo}
                          alt={rest.name}
                          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 1 }}
                        />
                      </div>
                      {rest.name}
                    </div>
                  </td>
                  {displayWeeks.map((w) => {
                    const cell = dataMap[rest.id]?.[w];
                    const count = cell?.reviewCount ?? 0;
                    const avgR = cell?.avgRating;
                    return (
                      <td key={w} style={{ textAlign: 'center', padding: '0.5rem 0.4rem', fontSize: '0.85rem' }}>
                        {count > 0 ? (
                          <div>
                            <span className="font-numeric" style={{
                              fontWeight: 700,
                              color: count >= 20 ? 'var(--green)' : count >= 10 ? 'var(--text-main)' : 'var(--text-dim)',
                            }}>
                              {count}
                            </span>
                            {avgR != null && (
                              <div className="font-numeric" style={{
                                fontSize: '0.6rem',
                                color: Number(avgR) >= 4.5 ? 'var(--green)' : Number(avgR) >= 3.5 ? 'var(--text-dim)' : 'var(--red)',
                                marginTop: 1,
                              }}>
                                {Number(avgR).toFixed(1)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>–</span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }}>
                    <span className="font-numeric" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {fmt(cumulative)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatWeekShort(weekStartStr: string): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

const thStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align,
  padding: '0.5rem 0.75rem',
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-dark)',
  whiteSpace: 'nowrap',
});

const tdNumStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
};

/* ── Table helpers ── */

function SortTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        textAlign: align,
        padding: '0.6rem 0.75rem',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: active ? 'var(--text-main)' : 'var(--text-muted)',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border-dark)',
      }}
    >
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

function TdCell({ children, align }: { children: React.ReactNode; align: 'left' | 'right' }) {
  return (
    <td style={{ textAlign: align, padding: '0.6rem 0.75rem', fontSize: '0.9rem' }}>
      {children}
    </td>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { getBrandForSlug } from '@/lib/brands';
import { t } from '@/lib/i18n';

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

interface Props {
  stats: RestaurantStats[];
  unresolvedCounts: Record<number, number>;
  roiByLocation: Record<number, ROIStats>;
  googleTrends: Record<number, GoogleTrend | null>;
}

type SortKey = 'restaurantName' | 'weeklyReviews' | 'weeklyAvg' | 'totalReviews' | 'totalAvg' | 'unresolved' | 'roi' | 'ratingChange';

/* ── Main Component ── */

export default function OwnerOverview({ stats, unresolvedCounts, roiByLocation, googleTrends }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('roi');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* ── PORTFOLIO ROI HERO ── */}
      <div
        style={{
          background: '#111111',
          border: '1px solid #111111',
          padding: '2rem',
          color: '#FAFAFA',
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
            height: 2,
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
            marginBottom: '1.25rem',
          }}
        >
          {t.owner.portfolioImpact(stats.length)}
        </div>

        <div style={{ marginBottom: '1.75rem' }}>
          {portfolioROI.locationsWithGain > 0 ? (
            <>
              <div
                className="editorial-serif"
                style={{
                  fontSize: '3.2rem',
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                +{portfolioROI.avgRatingGain.toFixed(1)} <span style={{ color: '#D97706' }}>&#9733;</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                {t.owner.avgGoogleRatingGain(portfolioROI.locationsWithGain)}
              </div>
            </>
          ) : (
            <>
              <div
                className="font-numeric"
                style={{
                  fontSize: '3.2rem',
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {portfolioROI.totalReviews.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                {t.owner.totalScansProcessed}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <ROICard
            label={t.owner.sentToGoogle}
            value={portfolioROI.totalGoogleSends.toLocaleString()}
            sub={portfolioROI.totalReviewsGained > 0
              ? t.owner.newGoogleReviewsConfirmed(portfolioROI.totalReviewsGained)
              : t.owner.customersDirectedToGoogle}
            color="#4ade80"
            borderColor="rgba(34, 197, 94, 0.3)"
          />
          <ROICard
            label={t.owner.badReviewsPrevented}
            value={portfolioROI.totalIntercepted.toLocaleString()}
            sub={t.owner.negativeReviewsCaughtPrivately}
            color="#fbbf24"
            borderColor="rgba(245, 158, 11, 0.3)"
          />
          <ROICard
            label={t.owner.totalScans}
            value={portfolioROI.totalReviews.toLocaleString()}
            sub={t.owner.thisWeek(totalWeekly)}
            color="#fafafa"
            borderColor="rgba(255, 255, 255, 0.15)"
          />
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

      {/* ── Location Table ── */}
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
                        <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{r.restaurantName}</span>
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
                        <span className="font-numeric" style={{ color: 'var(--red)', fontWeight: 600 }}>{r.unresolved}</span>
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
      </section>
    </div>
  );
}

/* ── ROI Card ── */

function ROICard({
  label,
  value,
  sub,
  color,
  borderColor,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  borderColor: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        padding: '1rem 1.15rem',
      }}
    >
      <div
        style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="font-numeric" style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>{sub}</div>
    </div>
  );
}

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

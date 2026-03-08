'use client';

import { useState, useMemo } from 'react';
import { getBrandForSlug } from '@/lib/brands';

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

type SortKey = 'restaurantName' | 'weeklyReviews' | 'weeklyAvg' | 'totalReviews' | 'totalAvg' | 'unresolved' | 'roi' | 'ratingChange';

/* ── Main Component ── */

export default function OwnerOverview({ stats, unresolvedCounts, roiByLocation, googleTrends }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('roi');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Compute aggregate impact across all locations
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
        const roiValue = roi
          ? roi.googleSends + roi.intercepted
          : 0;
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
          background: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
          borderRadius: 14,
          padding: '2rem',
          color: '#fafaf9',
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
          Portfolio Impact — All {stats.length} Locations
        </div>

        {/* Hero: avg rating gain if available, otherwise total scans */}
        <div style={{ marginBottom: '1.75rem' }}>
          {portfolioROI.locationsWithGain > 0 ? (
            <>
              <div
                style={{
                  fontSize: '3.2rem',
                  fontWeight: 800,
                  lineHeight: 1,
                  color: '#fafaf9',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                +{portfolioROI.avgRatingGain.toFixed(1)} <span style={{ color: 'var(--amber-500)' }}>★</span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                Average Google rating gain across {portfolioROI.locationsWithGain} {portfolioROI.locationsWithGain === 1 ? 'location' : 'locations'}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: '3.2rem',
                  fontWeight: 800,
                  lineHeight: 1,
                  color: '#fafaf9',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {portfolioROI.totalReviews.toLocaleString()}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.4rem' }}>
                Total scans processed across all locations
              </div>
            </>
          )}
        </div>

        {/* Breakdown grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <ROICard
            label="Sent to Google"
            value={portfolioROI.totalGoogleSends.toLocaleString()}
            sub={portfolioROI.totalReviewsGained > 0
              ? `${portfolioROI.totalReviewsGained} new Google reviews confirmed`
              : 'customers directed to Google'}
            color="#4ade80"
            bgColor="rgba(34, 197, 94, 0.1)"
            borderColor="rgba(34, 197, 94, 0.2)"
          />
          <ROICard
            label="Bad Reviews Prevented"
            value={portfolioROI.totalIntercepted.toLocaleString()}
            sub="negative reviews caught privately"
            color="#fbbf24"
            bgColor="rgba(245, 158, 11, 0.1)"
            borderColor="rgba(245, 158, 11, 0.2)"
          />
          <ROICard
            label="Total Scans"
            value={portfolioROI.totalReviews.toLocaleString()}
            sub={`${totalWeekly} this week`}
            color="#fafaf9"
            bgColor="rgba(255, 255, 255, 0.04)"
            borderColor="rgba(255, 255, 255, 0.1)"
          />
        </div>
      </div>

      {/* ── Unresolved alert ── */}
      {totalUnresolved > 0 && (
        <div
          style={{
            padding: '1rem 1.25rem',
            borderRadius: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.95rem' }}>
            {totalUnresolved} unresolved feedback {totalUnresolved === 1 ? 'item' : 'items'} across all locations
          </p>
        </div>
      )}

      {/* ── Location Table (with ROI columns) ── */}
      <section style={card}>
        <h2 style={sectionTitle}>All Locations</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Restaurant" sortKey="restaurantName" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Impact" sortKey="roi" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortTh label="Google ★" sortKey="ratingChange" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortTh label="Weekly" sortKey="weeklyReviews" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortTh label="Unresolved" sortKey="unresolved" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                <SortTh label="Total" sortKey="totalReviews" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const brand = getBrandForSlug(r.slug);
                return (
                  <tr key={r.restaurantId} style={{ borderTop: '1px solid var(--stone-200)' }}>
                    {/* Restaurant */}
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            overflow: 'hidden',
                            background: brand.darkBg ? '#000' : '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            border: '1px solid var(--stone-200)',
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

                    {/* Impact */}
                    <TdCell align="right">
                      <span style={{ fontWeight: 700, color: 'var(--success)' }}>
                        {r.googleSends}
                      </span>
                      <span style={{ color: 'var(--stone-400)', margin: '0 3px' }}>/</span>
                      <span style={{ fontWeight: 700, color: '#fbbf24' }}>
                        {r.intercepted}
                      </span>
                      <div style={{ fontSize: '0.65rem', color: 'var(--stone-400)', marginTop: 1 }}>
                        sent / caught
                      </div>
                    </TdCell>

                    {/* Google Rating */}
                    <TdCell align="right">
                      {r.currentRating != null ? (
                        <div>
                          <span style={{ fontWeight: 600 }}>{r.currentRating.toFixed(1)}</span>
                          <span style={{ color: 'var(--amber-500)', marginLeft: 2 }}>★</span>
                          {r.ratingChange !== 0 && (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                color: r.ratingChange > 0 ? 'var(--success)' : '#dc2626',
                                marginTop: 1,
                              }}
                            >
                              {r.ratingChange > 0 ? '+' : ''}{r.ratingChange.toFixed(1)}
                              {r.reviewsGained > 0 && (
                                <span style={{ color: 'var(--stone-400)', fontWeight: 400 }}>
                                  {' '}(+{r.reviewsGained})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--stone-400)' }}>--</span>
                      )}
                    </TdCell>

                    {/* Weekly */}
                    <TdCell align="right">
                      {r.weeklyReviews}
                      {r.weeklyAvg != null && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--stone-400)' }}>
                          {Number(r.weeklyAvg).toFixed(1)} avg
                        </div>
                      )}
                    </TdCell>

                    {/* Unresolved */}
                    <TdCell align="right">
                      {r.unresolved > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>{r.unresolved}</span>
                      ) : (
                        <span style={{ color: 'var(--success)' }}>0</span>
                      )}
                    </TdCell>

                    {/* Total */}
                    <TdCell align="right">{r.totalReviews}</TdCell>
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

/* ── ROI Card (dark theme) ── */

function ROICard({
  label,
  value,
  sub,
  color,
  bgColor,
  borderColor,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: '1rem 1.15rem',
      }}
    >
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
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
        padding: '0.5rem 0.75rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: active ? 'var(--espresso)' : 'var(--stone-500)',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
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

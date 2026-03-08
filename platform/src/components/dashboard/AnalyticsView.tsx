'use client';

import { downloadCSV } from '@/lib/csv';


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
  ratingDistribution: Record<number, number>;
  dailyCounts: { date: string; count: number; avgRating: number }[];
  conversion: { rate: number; above: number; sent: number };
  leaderboard: {
    staffId: number | null;
    staffName: string | null;
    staffCode: string | null;
    avgRating: number;
    reviewCount: number;
  }[];
  roiStats: ROIStats;
  googleTrend: GoogleTrend | null;
}

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

export default function AnalyticsView({
  weeklyStats,
  allTimeStats,
  ratingDistribution,
  dailyCounts,
  conversion,
  leaderboard,
  roiStats,
  googleTrend,
}: Props) {
  const totalRatings = Object.values(ratingDistribution).reduce((a, b) => a + b, 0);
  const maxBar = Math.max(...Object.values(ratingDistribution), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Impact Summary Banner */}
      {roiStats.totalReviews > 0 && (
        <div
          style={{
            background: 'var(--espresso)',
            borderRadius: 12,
            padding: '1.25rem 1.5rem',
            color: 'var(--warm-white)',
            display: 'flex',
            alignItems: 'center',
            gap: '2rem',
            flexWrap: 'wrap',
          }}
        >
          {googleTrend && googleTrend.ratingChange !== 0 ? (
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: 4 }}>
                Google Rating
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.4)' }}>{googleTrend.baselineRating.toFixed(1)}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>→</span>
                <span style={{ fontSize: '2rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{googleTrend.currentRating.toFixed(1)} ★</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: googleTrend.ratingChange > 0 ? '#4ade80' : '#f87171' }}>
                  {googleTrend.ratingChange > 0 ? '+' : ''}{googleTrend.ratingChange.toFixed(1)}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f59e0b', marginBottom: 4 }}>
                All-Time Impact
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {roiStats.totalReviews} scans
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Sent to Google</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#4ade80' }}>{roiStats.googleSends}</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                {googleTrend && googleTrend.reviewsGained > 0
                  ? `${googleTrend.reviewsGained} confirmed new reviews`
                  : 'customers directed to Google'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Intercepted</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fbbf24' }}>{roiStats.intercepted}</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>bad reviews caught privately</div>
            </div>
          </div>
        </div>
      )}

      {/* Overview Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
        }}
      >
        <MiniCard label="All-Time Reviews" value={allTimeStats.totalReviews} />
        <MiniCard
          label="All-Time Avg"
          value={allTimeStats.avgRating ? allTimeStats.avgRating.toFixed(1) : '--'}
          suffix=" ★"
        />
        <MiniCard label="Google Sends" value={allTimeStats.googleSends} />
        <MiniCard label="Feedback Received" value={allTimeStats.feedbackCount} />
        <MiniCard label="This Week" value={weeklyStats.totalReviews} />
        <MiniCard
          label="Google Conversion"
          value={`${conversion.rate}%`}
          sub={`${conversion.sent} of ${conversion.above} eligible`}
        />
      </div>

      {/* Rating Distribution */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Rating Distribution</h2>
          <button
            onClick={() =>
              downloadCSV(
                [5, 4, 3, 2, 1].map((star) => ({
                  Stars: star,
                  Count: ratingDistribution[star] || 0,
                  Percentage: totalRatings > 0 ? `${Math.round(((ratingDistribution[star] || 0) / totalRatings) * 100)}%` : '0%',
                })),
                'rating-distribution.csv',
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
            Export CSV
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[5, 4, 3, 2, 1].map((star) => {
            const cnt = ratingDistribution[star] || 0;
            const pct = totalRatings > 0 ? Math.round((cnt / totalRatings) * 100) : 0;
            return (
              <div key={star} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  style={{
                    width: 50,
                    textAlign: 'right',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: 'var(--espresso)',
                  }}
                >
                  {star} ★
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 24,
                    background: 'var(--stone-100)',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(cnt / maxBar) * 100}%`,
                      height: '100%',
                      background:
                        star >= 4
                          ? 'var(--success)'
                          : star === 3
                            ? 'var(--amber-500)'
                            : '#dc2626',
                      borderRadius: 6,
                      transition: 'width 0.4s ease',
                      minWidth: cnt > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 70,
                    fontSize: '0.8rem',
                    color: 'var(--stone-500)',
                  }}
                >
                  {cnt} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Daily Activity */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>Daily Reviews (Last 30 Days)</h2>
          {dailyCounts.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  dailyCounts.map((d) => ({
                    Date: d.date,
                    Reviews: d.count,
                    'Avg Rating': d.avgRating?.toFixed(1) ?? '',
                  })),
                  'daily-reviews.csv',
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
              Export CSV
            </button>
          )}
        </div>
        {dailyCounts.length === 0 ? (
          <p style={{ color: 'var(--stone-400)', fontStyle: 'italic', margin: 0 }}>
            No reviews in the last 30 days.
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
                    title={`${d.date}: ${d.count} reviews, avg ${d.avgRating?.toFixed(1) ?? '--'}`}
                    style={{
                      flex: 1,
                      minWidth: 14,
                      maxWidth: 32,
                      height: Math.max(h, 3),
                      background:
                        d.avgRating >= 4
                          ? 'var(--success)'
                          : d.avgRating >= 3
                            ? 'var(--amber-500)'
                            : '#dc2626',
                      borderRadius: '3px 3px 0 0',
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
                marginTop: '0.4rem',
                fontSize: '0.7rem',
                color: 'var(--stone-400)',
              }}
            >
              <span>{dailyCounts[0]?.date}</span>
              <span>{dailyCounts[dailyCounts.length - 1]?.date}</span>
            </div>
          </div>
        )}
      </section>

      {/* Top Performers */}
      <section style={card}>
        <h2 style={sectionTitle}>Top Performers This Week</h2>
        {leaderboard.length === 0 ? (
          <p style={{ color: 'var(--stone-400)', fontStyle: 'italic', margin: 0 }}>
            No reviews this week yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {leaderboard.slice(0, 5).map((entry, i) => (
              <div
                key={entry.staffId ?? i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  background: i === 0 ? 'var(--success-light)' : 'var(--stone-100)',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: i === 0 ? 'var(--success)' : 'var(--stone-300)',
                    color: i === 0 ? 'white' : 'var(--stone-700)',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem' }}>
                  {entry.staffName ?? 'Unknown'}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--stone-500)' }}>
                  {entry.reviewCount} reviews
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {entry.avgRating.toFixed(1)} ★
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

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
    <div style={card}>
      <p
        style={{
          margin: 0,
          fontSize: '0.75rem',
          color: 'var(--stone-500)',
          marginBottom: '0.2rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: 0,
          fontSize: '1.6rem',
          fontWeight: 700,
          color: 'var(--espresso)',
        }}
      >
        {value}
        {suffix && (
          <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--amber-500)' }}>
            {suffix}
          </span>
        )}
      </p>
      {sub && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--stone-400)', marginTop: '0.15rem' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

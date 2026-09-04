import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOverviewStats, getNewFeedbackCount, getROIStats, getWeeklyHistory, getTotalReviewsBefore, getWeeklyHistoryByRestaurant } from '@/lib/queries';
import { getGoogleRatingTrendBatch } from '@/lib/google-places';
import { getComplaintSlaStats, type ComplaintSlaStats } from '@/lib/complaint-sla';
import { startOfWeek } from 'date-fns';
import OwnerOverview from '@/components/dashboard/OwnerOverview';

function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export default async function OverviewPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  // Owner & regional managers only
  if (session.role !== 'owner' && session.role !== 'regional') redirect('/dashboard');

  const stats = await getOverviewStats(session.role === 'regional' ? session.region : undefined);

  // Fetch unresolved counts, ROI stats, and Google trends in parallel
  const unresolvedCounts: Record<number, number> = {};
  const roiByLocation: Record<number, Awaited<ReturnType<typeof getROIStats>>> = {};
  const complaintSlaByLocation: Record<number, ComplaintSlaStats> = {};
  const restaurantIds = stats.map((r) => r.restaurantId);
  const now = new Date();

  const regionFilter = session.role === 'regional' ? session.region : undefined;

  const [, , googleTrends, weeklyHistory, baselineTotal, weeklyByRestaurant] = await Promise.all([
    // Unresolved feedback per location
    Promise.all(
      stats.map(async (r) => {
        unresolvedCounts[r.restaurantId] = await getNewFeedbackCount(r.restaurantId);
      }),
    ),
    // ROI stats per location
    Promise.all(
      stats.map(async (r) => {
        roiByLocation[r.restaurantId] = await getROIStats(r.restaurantId, r.googleThreshold);
      }),
    ),
    // Google trends per location
    getGoogleRatingTrendBatch(restaurantIds),
    // Weekly history (last 12 weeks)
    getWeeklyHistory(regionFilter, 12),
    // Total reviews before the 12-week window (for cumulative baseline)
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 12 * 7);
      return getTotalReviewsBefore(startOfWeek(d, { weekStartsOn: 1 }), regionFilter);
    })(),
    // Per-restaurant weekly history (last 12 weeks)
    getWeeklyHistoryByRestaurant(regionFilter, 12),
    // Complaint response times per scoped location
    Promise.all(
      stats.map(async (r) => {
        complaintSlaByLocation[r.restaurantId] = await getComplaintSlaStats(
          r.restaurantId,
          now,
        );
      }),
    ),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <OwnerOverview
        stats={stats}
        unresolvedCounts={unresolvedCounts}
        roiByLocation={roiByLocation}
        googleTrends={googleTrends}
        weeklyHistory={weeklyHistory}
        baselineTotal={baselineTotal}
        weeklyByRestaurant={weeklyByRestaurant}
      />

      {stats.length > 0 && (
        <section
          aria-labelledby="complaint-sla-heading"
          style={{
            background: 'var(--panel-bg)',
            border: '1px solid var(--border-dark)',
            padding: '1.75rem 2rem',
          }}
        >
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{
              margin: '0 0 0.35rem',
              color: '#D97706',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}>
              Seguimiento por ubicación
            </p>
            <h2
              id="complaint-sla-heading"
              style={{
                margin: 0,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-serif)',
                fontSize: '1.35rem',
                fontWeight: 600,
              }}
            >
              Quejas y tiempos de respuesta (30 días)
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
          }}>
            {stats.map((restaurant) => {
              const complaintStats = complaintSlaByLocation[restaurant.restaurantId];
              const reviewedPercent = percentage(
                complaintStats.reviewedWithin2h,
                complaintStats.received,
              );
              const resolvedPercent = percentage(
                complaintStats.resolvedWithin24h,
                complaintStats.received,
              );

              return (
                <article
                  key={restaurant.restaurantId}
                  style={{
                    border: '1px solid var(--panel-border)',
                    background: 'var(--bg-base)',
                    padding: '1rem',
                  }}
                >
                  <h3 style={{
                    margin: '0 0 0.9rem',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                  }}>
                    {restaurant.restaurantName}
                  </h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '0.55rem',
                  }}>
                    <div style={{ padding: '0.75rem', border: '1px solid var(--panel-border)' }}>
                      <p className="font-numeric" style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.35rem', fontWeight: 700 }}>
                        {complaintStats.received}
                      </p>
                      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.68rem', lineHeight: 1.35 }}>
                        Recibidas
                      </p>
                    </div>
                    <div style={{ padding: '0.75rem', border: '1px solid var(--panel-border)' }}>
                      <p className="font-numeric" style={{ margin: 0, color: 'var(--blue)', fontSize: '1.35rem', fontWeight: 700 }}>
                        {complaintStats.reviewedWithin2h} <span style={{ fontSize: '0.72rem' }}>({reviewedPercent}%)</span>
                      </p>
                      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.68rem', lineHeight: 1.35 }}>
                        Revisadas en menos de 2 h
                      </p>
                    </div>
                    <div style={{ padding: '0.75rem', border: '1px solid var(--panel-border)' }}>
                      <p className="font-numeric" style={{ margin: 0, color: 'var(--green)', fontSize: '1.35rem', fontWeight: 700 }}>
                        {complaintStats.resolvedWithin24h} <span style={{ fontSize: '0.72rem' }}>({resolvedPercent}%)</span>
                      </p>
                      <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.68rem', lineHeight: 1.35 }}>
                        Resueltas en menos de 24 h
                      </p>
                    </div>
                    <Link
                      href="/intercepted"
                      style={{
                        padding: '0.75rem',
                        border: `1px solid ${complaintStats.overdueOpen > 0 ? '#D97706' : 'var(--panel-border)'}`,
                        background: complaintStats.overdueOpen > 0 ? 'var(--gold-light)' : 'transparent',
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                    >
                      <p className="font-numeric" style={{ margin: 0, color: complaintStats.overdueOpen > 0 ? '#B45309' : 'var(--text-main)', fontSize: '1.35rem', fontWeight: 700 }}>
                        {complaintStats.overdueOpen}
                      </p>
                      <p style={{ margin: '0.25rem 0 0', color: complaintStats.overdueOpen > 0 ? '#92400E' : 'var(--text-muted)', fontSize: '0.68rem', lineHeight: 1.35 }}>
                        Vencidas
                      </p>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

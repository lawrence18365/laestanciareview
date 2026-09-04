import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getRestaurantBySlug, getAllFeedback } from '@/lib/queries';
import { getComplaintSlaStats } from '@/lib/complaint-sla';
import FeedbackInbox from '@/components/dashboard/FeedbackInbox';

function percentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export default async function InboxPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  if (session.role === 'owner' || session.role === 'regional') redirect('/overview');

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) redirect('/login');

  const [feedback, complaintStats] = await Promise.all([
    getAllFeedback(restaurant.id),
    getComplaintSlaStats(restaurant.id, new Date()),
  ]);
  const reviewedPercent = percentage(
    complaintStats.reviewedWithin2h,
    complaintStats.received,
  );
  const resolvedPercent = percentage(
    complaintStats.resolvedWithin24h,
    complaintStats.received,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section
        aria-labelledby="complaint-sla-heading"
        className="flat-panel"
        style={{ padding: '1rem 1.25rem' }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '0.85rem',
        }}>
          <h2
            id="complaint-sla-heading"
            style={{
              margin: 0,
              color: 'var(--text-main)',
              fontFamily: 'var(--font-serif)',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            Quejas y tiempos de respuesta (30 días)
          </h2>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.25rem 0.55rem',
            border: `1px solid ${complaintStats.overdueOpen > 0 ? '#D97706' : 'var(--panel-border)'}`,
            background: complaintStats.overdueOpen > 0 ? 'var(--gold-light)' : 'var(--bg-base)',
            color: complaintStats.overdueOpen > 0 ? '#92400E' : 'var(--text-muted)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Vencidas: <span className="font-numeric">{complaintStats.overdueOpen}</span>
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
          borderTop: '1px solid var(--panel-border)',
        }}>
          {[
            { value: String(complaintStats.received), label: 'Recibidas' },
            {
              value: `${complaintStats.reviewedWithin2h} (${reviewedPercent}%)`,
              label: 'Revisadas en menos de 2 h',
            },
            {
              value: `${complaintStats.resolvedWithin24h} (${resolvedPercent}%)`,
              label: 'Resueltas en menos de 24 h',
            },
            { value: String(complaintStats.overdueOpen), label: 'Vencidas' },
          ].map((item) => (
            <div key={item.label} style={{ padding: '0.75rem 0.75rem 0.15rem 0' }}>
              <p className="font-numeric" style={{ margin: 0, color: item.label === 'Vencidas' && complaintStats.overdueOpen > 0 ? '#B45309' : 'var(--text-main)', fontSize: '1.1rem', fontWeight: 700 }}>
                {item.value}
              </p>
              <p style={{ margin: '0.2rem 0 0', color: 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1.35 }}>
                {item.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <FeedbackInbox
        initialFeedback={feedback.map((f) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}

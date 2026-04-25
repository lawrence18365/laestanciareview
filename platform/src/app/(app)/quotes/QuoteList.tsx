'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

type Quote = {
  id: number;
  quoteNumber: string | null;
  status: string;
  clientName: string;
  clientCompany: string | null;
  eventDate: string | null;
  eventType: string | null;
  guestCount: number;
  pricePerPerson: string;
  serviceChargePercent: string;
  ivaPercent: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: t.quotes.draft,
  sent: t.quotes.sent,
  accepted: t.quotes.accepted,
  expired: t.quotes.expired,
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#888',
  sent: '#2196f3',
  accepted: '#43a047',
  expired: '#e53935',
};

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function quoteTotal(q: Quote): number {
  const pp = parseFloat(q.pricePerPerson) || 0;
  const sc = parseFloat(q.serviceChargePercent) || 0;
  const iva = parseFloat(q.ivaPercent) || 0;
  const sub = pp * q.guestCount;
  const withSC = sub * (1 + sc / 100);
  return Math.round(withSC * (1 + iva / 100));
}

export default function QuoteList({
  quotes: initialQuotes,
  restaurantName,
}: {
  quotes: Quote[];
  restaurantName: string;
}) {
  const router = useRouter();
  const [quotes, setQuotes] = useState(initialQuotes);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function handleDelete(id: number) {
    if (!confirm(t.quotes.confirmDelete)) return;
    setDeleting(id);
    try {
      await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
      setQuotes((prev) => prev.filter((q) => q.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="ql-root">
      <style>{QL_CSS}</style>
      <div className="ql-header">
        <div>
          <h1 className="ql-title">
            {t.quotes.title}
          </h1>
          <p className="ql-subtitle">
            {restaurantName}
          </p>
        </div>
        <button
          onClick={() => router.push('/quotes/new')}
          className="ql-new-btn"
        >
          + {t.quotes.newQuote}
        </button>
      </div>

      {quotes.length === 0 ? (
        <div className="ql-empty">
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{t.quotes.noQuotes}</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>{t.quotes.createFirst}</p>
        </div>
      ) : (
        <div className="ql-list">
          {quotes.map((q) => (
            <div key={q.id} className="ql-card">
              <div className="ql-card-info">
                <div className="ql-card-meta">
                  <span className="ql-folio">
                    {q.quoteNumber ?? `Q-${q.id}`}
                  </span>
                  <span
                    className="ql-status"
                    style={{
                      color: STATUS_COLORS[q.status] ?? '#888',
                      borderColor: STATUS_COLORS[q.status] ?? '#888',
                    }}
                  >
                    {STATUS_LABELS[q.status] ?? q.status}
                  </span>
                </div>
                <p className="ql-client">
                  {q.clientName}
                  {q.clientCompany && (
                    <span className="ql-company">· {q.clientCompany}</span>
                  )}
                </p>
                <div className="ql-card-details">
                  {q.eventDate && (
                    <span>
                      {new Date(q.eventDate + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  )}
                  <span>
                    {q.guestCount} {t.quotes.people}
                  </span>
                  <span className="ql-total">
                    {formatMXN(quoteTotal(q))}
                  </span>
                </div>
              </div>
              <div className="ql-card-actions">
                <button
                  onClick={() => router.push(`/quotes/${q.id}`)}
                  className="ql-action"
                >
                  Editar
                </button>
                <button
                  onClick={() => window.open(`/quotes/${q.id}/print`, '_blank')}
                  className="ql-action"
                >
                  PDF
                </button>
                <button
                  onClick={() => handleDelete(q.id)}
                  disabled={deleting === q.id}
                  className="ql-action ql-action-danger"
                  style={{ opacity: deleting === q.id ? 0.5 : 1 }}
                >
                  {deleting === q.id ? '...' : 'Eliminar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const QL_CSS = `
.ql-root { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
.ql-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.ql-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.ql-subtitle { margin: 0.25rem 0 0; font-size: 0.75rem; color: var(--text-dim); }
.ql-new-btn {
  padding: 0.6rem 1.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--text-main);
  color: var(--panel-bg);
  border: none;
  cursor: pointer;
  white-space: nowrap;
}
.ql-empty {
  padding: 3rem 1.5rem;
  text-align: center;
  border: 1px dashed var(--border-dark);
  color: var(--text-dim);
}
.ql-list { display: flex; flex-direction: column; gap: 0.75rem; }
.ql-card {
  background: var(--panel-bg);
  border: 1px solid var(--border-dark);
  padding: 1rem 1.25rem;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 1rem;
  align-items: center;
}
.ql-card-info { min-width: 0; }
.ql-card-meta { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.ql-folio { font-size: 0.65rem; font-family: var(--font-mono); color: var(--text-dim); }
.ql-status {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid;
  padding: 1px 6px;
}
.ql-client { margin: 0.35rem 0 0; font-size: 0.9rem; font-weight: 600; }
.ql-company { font-weight: 400; color: var(--text-dim); margin-left: 0.5rem; }
.ql-card-details {
  display: flex;
  gap: 1rem;
  margin-top: 0.35rem;
  flex-wrap: wrap;
  font-size: 0.74rem;
  color: var(--text-dim);
}
.ql-total { font-weight: 600; color: var(--text-main); }
.ql-card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
.ql-action {
  padding: 0.4rem 0.85rem;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--border-dark);
  cursor: pointer;
}
.ql-action-danger { color: var(--red); border-color: var(--red); }

/* iPad / tablet */
@media (max-width: 1024px) {
  .ql-root { padding: 1.5rem 1rem; }
}

/* Phone */
@media (max-width: 640px) {
  .ql-root { padding: 1rem 0.85rem; }
  .ql-header { gap: 0.6rem; }
  .ql-new-btn { width: 100%; padding: 0.85rem 1rem; font-size: 0.78rem; }
  .ql-card {
    grid-template-columns: 1fr;
    padding: 0.95rem;
    gap: 0.85rem;
  }
  .ql-client { font-size: 0.95rem; }
  .ql-card-details { font-size: 0.78rem; gap: 0.6rem 1rem; }
  .ql-card-actions { justify-content: stretch; }
  .ql-action {
    flex: 1 1 0;
    padding: 0.65rem 0.5rem;
    font-size: 0.7rem;
  }
}
`;

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
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t.quotes.title}
          </h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {restaurantName}
          </p>
        </div>
        <button
          onClick={() => router.push('/quotes/new')}
          style={{
            padding: '0.5rem 1.25rem',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: 'var(--text-main)',
            color: 'var(--panel-bg)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          + {t.quotes.newQuote}
        </button>
      </div>

      {quotes.length === 0 ? (
        <div style={{
          padding: '3rem 2rem',
          textAlign: 'center',
          border: '1px dashed var(--border-dark)',
          color: 'var(--text-dim)',
        }}>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>{t.quotes.noQuotes}</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem' }}>{t.quotes.createFirst}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {quotes.map((q) => (
            <div
              key={q.id}
              style={{
                background: 'var(--panel-bg)',
                border: '1px solid var(--border-dark)',
                padding: '1rem 1.25rem',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                    {q.quoteNumber ?? `Q-${q.id}`}
                  </span>
                  <span style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: STATUS_COLORS[q.status] ?? '#888',
                    border: `1px solid ${STATUS_COLORS[q.status] ?? '#888'}`,
                    padding: '1px 6px',
                  }}>
                    {STATUS_LABELS[q.status] ?? q.status}
                  </span>
                </div>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', fontWeight: 600 }}>
                  {q.clientName}
                  {q.clientCompany && (
                    <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '0.5rem' }}>
                      · {q.clientCompany}
                    </span>
                  )}
                </p>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                  {q.eventDate && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      {new Date(q.eventDate + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    {q.guestCount} {t.quotes.people}
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {formatMXN(quoteTotal(q))}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => router.push(`/quotes/${q.id}`)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-dark)',
                    cursor: 'pointer',
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => window.open(`/quotes/${q.id}/print`, '_blank')}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-dark)',
                    cursor: 'pointer',
                  }}
                >
                  PDF
                </button>
                <button
                  onClick={() => handleDelete(q.id)}
                  disabled={deleting === q.id}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    background: 'transparent',
                    color: 'var(--red)',
                    border: '1px solid var(--red)',
                    cursor: 'pointer',
                    opacity: deleting === q.id ? 0.5 : 1,
                  }}
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

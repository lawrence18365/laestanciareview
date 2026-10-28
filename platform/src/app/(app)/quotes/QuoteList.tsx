'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';
import {
  ACTIVE_STATUSES,
  QUOTE_STATUSES,
  STATUS_LABELS as LIFECYCLE_LABELS,
  STATUS_COLORS as LIFECYCLE_COLORS,
  formatPesos,
  type QuoteConversion,
  type QuoteStatus,
} from '@/lib/quote-status';

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
  createdAt: string;
  outcomeAt?: string | null;
  outcomeAmountMxn?: number | null;
  // Internal campaign tag ("campaign:posadas-2026"), null when the quote isn't part of
  // a campaign. Filtered client-side over the rows already loaded.
  campaignTag?: string | null;
};

// Labels/colours come from lib/quote-status (re-exported by lib/quote-lifecycle)
// so the list, the readout and the API can never disagree about what a status is
// called — and so this client component never imports the server-only module.
const STATUS_LABELS: Record<string, string> = LIFECYCLE_LABELS;

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(LIFECYCLE_COLORS).map(([status, c]) => [status, c.text]),
);

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function quoteTotal(q: Quote): number {
  // pricePerPerson is already servicio + IVA inclusive, derived from config_json server-side.
  return Math.round((parseFloat(q.pricePerPerson) || 0) * q.guestCount);
}

export default function QuoteList({
  quotes: initialQuotes,
  restaurantName,
  conversion,
}: {
  quotes: Quote[];
  restaurantName: string;
  conversion: QuoteConversion;
}) {
  const router = useRouter();
  const [quotes, setQuotes] = useState(initialQuotes);
  // Active by default. Closed quotes stay in the database and stay countable;
  // they are just not what you are working on today.
  const [showClosed, setShowClosed] = useState(false);

  const isActive = (q: Quote) =>
    (ACTIVE_STATUSES as string[]).includes(q.status);
  const activeCount = quotes.filter(isActive).length;
  const closedCount = quotes.length - activeCount;

  // Campaign filter. Distributed client-side over the rows already loaded —
  // no extra query, and the counts stay honest if the list is stale.
  const [campaign, setCampaign] = useState('');
  const campaignTags = Array.from(
    new Set(quotes.map((q) => q.campaignTag).filter((t): t is string => !!t)),
  ).sort((a, b) => a.localeCompare(b, 'es'));
  const inCampaign = (q: Quote) => !campaign || q.campaignTag === campaign;
  const campaignQuotes = campaign ? quotes.filter((q) => q.campaignTag === campaign) : [];
  const campaignCounts = QUOTE_STATUSES.map((status) => ({
    status,
    count: campaignQuotes.filter((q) => q.status === status).length,
  })).filter((c) => c.count > 0);
  const campaignWonTotal = campaignQuotes
    .filter((q) => q.status === 'won')
    .reduce((sum, q) => sum + (q.outcomeAmountMxn ?? 0), 0);

  const visibleQuotes = quotes.filter(
    (q) => inCampaign(q) && (showClosed ? !isActive(q) : isActive(q)),
  );
  const [deleting, setDeleting] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);

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

  // Mint (or reuse) the public share link and open WhatsApp prefilled to the
  // client. First send flips the quote to "sent".
  async function handleSend(id: number) {
    setSending(id);
    // Open the tab synchronously inside the click gesture so mobile Safari
    // doesn't block the popup; we redirect it once the link is minted, or
    // close it on failure. (Hostesses run this on phones.)
    const waWindow = window.open('', '_blank');
    try {
      const res = await fetch(`/api/quotes/${id}/send`, { method: 'POST' });
      if (!res.ok) {
        waWindow?.close();
        let msg = 'No se pudo generar el enlace para compartir.';
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) msg = err.error;
        } catch {
          /* non-JSON error body — keep the default message */
        }
        alert(msg);
        return;
      }
      const data = (await res.json()) as { waLink: string; status: string };
      setQuotes((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status: data.status } : q)),
      );
      if (waWindow) waWindow.location.href = data.waLink;
      else window.open(data.waLink, '_blank', 'noopener,noreferrer');
    } catch {
      waWindow?.close();
      alert('Error de red. Intenta de nuevo.');
    } finally {
      setSending(null);
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

      {/* Conversion readout: the one line to take to the owner or a prospect.
          Sent counts by send date and won counts by close date, so these are
          not two views of the same rows — never shown as a percentage. */}
      <div className="ql-conversion">
        <div>
          <span className="ql-conv-value">{conversion.sent}</span>
          <span className="ql-conv-label">Cotizaciones enviadas</span>
        </div>
        <div>
          <span className="ql-conv-value">{conversion.won}</span>
          <span className="ql-conv-label">Eventos ganados</span>
        </div>
        <div>
          <span className="ql-conv-value">{formatPesos(conversion.pesosCollected)}</span>
          <span className="ql-conv-label">Pesos cobrados</span>
        </div>
        <div>
          <span className="ql-conv-value">{conversion.open}</span>
          <span className="ql-conv-label">Abiertas hoy</span>
        </div>
      </div>
      <p className="ql-conv-note">Últimos 12 meses. Enviadas por fecha de envío, ganadas por fecha de cierre.</p>

      <div className="ql-filterbar">
        <button
          className={`ql-filter-btn${!showClosed ? ' active' : ''}`}
          onClick={() => setShowClosed(false)}
        >
          Activas ({activeCount})
        </button>
        <button
          className={`ql-filter-btn${showClosed ? ' active' : ''}`}
          onClick={() => setShowClosed(true)}
        >
          Historial ({closedCount})
        </button>
        {campaignTags.length > 0 && (
          <select
            className="ql-campaign-select"
            aria-label="Filtrar por campaña"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          >
            <option value="">Todas las campañas</option>
            {campaignTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* One line per campaign: how the pipeline is split and what it has
          actually collected. Counts cover every status, not just the tab. */}
      {campaign && (
        <p className="ql-campaign-summary">
          <strong>{campaign}</strong>
          {campaignCounts.map(({ status, count }) => (
            <span key={status}>
              {' · '}
              {STATUS_LABELS[status] ?? status}: {count}
            </span>
          ))}
          <span>
            {' · '}Ganado: <strong>{formatMXN(campaignWonTotal)}</strong>
          </span>
        </p>
      )}

      {visibleQuotes.length === 0 ? (
        <div className="ql-empty">
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            {showClosed ? 'Sin cotizaciones cerradas todavía.' : t.quotes.noQuotes}
          </p>
          {!showClosed && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>{t.quotes.createFirst}</p>
          )}
        </div>
      ) : (
        <div className="ql-list">
          {visibleQuotes.map((q) => (
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
                  {q.campaignTag && (
                    <span className="ql-campaign-chip">{q.campaignTag}</span>
                  )}
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
                  onClick={() => handleSend(q.id)}
                  disabled={sending === q.id}
                  className="ql-action"
                  style={{ opacity: sending === q.id ? 0.5 : 1 }}
                >
                  {sending === q.id ? '...' : 'Enviar'}
                </button>
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
  font-size: 1.3rem;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.ql-subtitle { margin: 0.5rem 0 0; font-size: 0.8rem; line-height: 1.45; color: var(--text-muted); }
.ql-new-btn {
  min-height: 44px;
  padding: 0.6rem 1.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--text-main);
  color: var(--panel-bg);
  border: 1px solid var(--text-main);
  border-radius: 0;
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
.ql-folio { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-muted); }
.ql-conversion {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1rem;
  margin-bottom: 0.5rem;
  background: var(--panel-bg);
  border: 1px solid var(--border-dark);
  border-radius: 0;
  box-shadow: var(--shadow-md);
}
.ql-conversion > div { text-align: center; }
.ql-conv-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.15;
}
.ql-conv-label {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1.35;
  color: var(--text-muted);
}
.ql-conv-note {
  margin: 0 0 1rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-muted);
}
.ql-filterbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.ql-filter-btn {
  min-height: 44px;
  padding: 0.55rem 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main);
  background: var(--panel-bg);
  border: 1px solid var(--border-dark);
  border-radius: 0;
  cursor: pointer;
}
.ql-filter-btn.active {
  color: var(--panel-bg);
  background: var(--text-main);
  border-color: var(--text-main);
}
.ql-campaign-select {
  min-height: 44px;
  min-width: 0;
  height: 44px;
  margin-left: auto;
  padding: 0.55rem 2.25rem 0.55rem 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main);
  background-color: var(--panel-bg);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
    linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 18px) calc(50% - 2px),
    calc(100% - 12px) calc(50% - 2px);
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
  border: 1px solid var(--border-dark);
  border-radius: 0;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}
.ql-campaign-summary {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-muted);
}
.ql-campaign-chip {
  padding: 2px 8px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.35;
  color: var(--text-main);
  background: var(--gold-light);
  border: 1px solid var(--gold);
  border-radius: 0;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .ql-conversion { grid-template-columns: repeat(2, 1fr); row-gap: 0.9rem; }
}
.ql-status {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.35;
  border: 1px solid;
  border-radius: 0;
  padding: 2px 8px;
}
.ql-client { margin: 0.5rem 0 0; font-size: 1rem; line-height: 1.35; font-weight: 600; }
.ql-company { font-size: 0.8rem; font-weight: 400; color: var(--text-muted); margin-left: 0.5rem; }
.ql-card-details {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-muted);
}
.ql-total { font-size: 22px; line-height: 1.25; font-weight: 700; color: var(--text-main); }
.ql-card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
.ql-action {
  min-height: 44px;
  min-width: 44px;
  padding: 0.55rem 0.9rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--border-dark);
  border-radius: 0;
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
    font-size: 0.75rem;
  }
}
`;

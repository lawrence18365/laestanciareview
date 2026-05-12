'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type LeadRow = {
  id: number;
  source: string;
  phone: string;
  name: string | null;
  tipoEvento: string | null;
  pax: number | null;
  fechaTentativa: string | null;
  presupuestoPp: string | null;
  prioridad: string | null;
  notasExtra: string | null;
  urgente: boolean;
  rawConversation: string | null;
  status: string;
  claimedBy: number | null;
  claimedAt: string | null;
  externalCreatedAt: string | null;
  createdAt: string;
};

type Metrics = {
  open: number;
  week: number;
  claimedToday: number;
  total: number;
  urgent: number;
};

type Filter = 'all' | 'open' | 'claimed' | 'urgent';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Todos',
  open: 'Sin tomar',
  claimed: 'Tomados',
  urgent: 'Urgentes',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo',
  claimed: 'Tomado',
  quoted: 'Cotizado',
  won: 'Ganado',
  lost: 'Perdido',
};

export default function LeadsTable({
  initial,
  focusId,
  restaurantName,
  metrics,
}: {
  initial: LeadRow[];
  focusId: number | null;
  restaurantName: string;
  metrics: Metrics;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Re-sync when the server pushes new data (router.refresh / revalidate).
  useEffect(() => setRows(initial), [initial]);

  // Open the focused lead in the drawer when arriving from a push notification.
  useEffect(() => {
    if (focusId == null) return;
    const match = initial.find((r) => r.id === focusId);
    if (match) setSelected(match);
  }, [focusId, initial]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'open' && r.claimedAt !== null) return false;
      if (filter === 'claimed' && r.claimedAt === null) return false;
      if (filter === 'urgent' && !r.urgente) return false;
      if (q) {
        const hay = `${r.name ?? ''} ${r.phone} ${r.tipoEvento ?? ''} ${r.notasExtra ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  async function claim(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/claim`, { method: 'POST' });
      if (!res.ok) {
        // Most likely: already claimed by someone else. Refresh truth.
        router.refresh();
        return;
      }
      const data = (await res.json()) as { lead: LeadRow };
      setRows((cur) =>
        cur.map((r) => (r.id === id ? { ...r, ...data.lead } : r)),
      );
      setSelected((cur) => (cur && cur.id === id ? { ...cur, ...data.lead } : cur));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="leads-root">
      <style>{LEADS_CSS}</style>

      <HeroMetrics metrics={metrics} />

      <header className="leads-header">
        <div className="leads-header-inner">
          <div>
            <h1 className="leads-title">Leads de eventos</h1>
            <p className="leads-subtitle">
              {restaurantName} ·{' '}
              <span className="leads-subtitle-meta">
                {metrics.open} sin tomar
                {metrics.urgent > 0 && (
                  <>
                    {' · '}
                    <strong className="leads-urgent-count">{metrics.urgent} urgente{metrics.urgent === 1 ? '' : 's'}</strong>
                  </>
                )}
              </span>
            </p>
          </div>
        </div>
      </header>

      <div className="leads-filterbar">
        <div className="leads-filters">
          {(['all', 'open', 'claimed', 'urgent'] as Filter[]).map((f) => {
            const active = filter === f;
            const count =
              f === 'all'
                ? metrics.total
                : f === 'open'
                  ? metrics.open
                  : f === 'claimed'
                    ? metrics.total - metrics.open
                    : metrics.urgent;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`leads-filter-btn${active ? ' active' : ''}`}
              >
                {FILTER_LABELS[f]}
                {count > 0 && <span className="leads-filter-count">{count}</span>}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre, teléfono o tipo…"
          className="leads-search"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState totalLeads={rows.length} filter={filter} />
      ) : (
        <>
          {/* Desktop / iPad: table */}
          <div className="leads-table-wrap">
            <table className="leads-table">
              <thead>
                <tr>
                  <Th>Estado</Th>
                  <Th>Tipo</Th>
                  <Th>Pax</Th>
                  <Th>Fecha</Th>
                  <Th>Presupuesto</Th>
                  <Th>Prioridad</Th>
                  <Th>Contacto</Th>
                  <Th>Recibido</Th>
                  <Th><span style={{ display: 'block', textAlign: 'right' }}>Acción</span></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const claimed = r.claimedAt !== null;
                  const isFocus = r.id === focusId;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={`leads-row${isFocus ? ' leads-row-focus' : ''}`}
                    >
                      <Td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <StatusBadge status={r.status} />
                          {r.urgente && <UrgentBadge />}
                        </div>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', textTransform: 'capitalize' }}>
                          {r.tipoEvento ?? '—'}
                        </div>
                      </Td>
                      <Td className="leads-num">{r.pax ?? '—'}</Td>
                      <Td>{r.fechaTentativa ?? '—'}</Td>
                      <Td>
                        {r.presupuestoPp ? (
                          <span className="leads-money">{r.presupuestoPp}</span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </Td>
                      <Td style={{ textTransform: 'capitalize', color: 'var(--text-muted)' }}>
                        {r.prioridad ?? '—'}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{r.name ?? '—'}</div>
                        <a
                          href={`https://wa.me/${r.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="leads-phone-link"
                        >
                          {formatPhone(r.phone)}
                        </a>
                      </Td>
                      <Td style={{ color: 'var(--text-muted)' }}>
                        {relTime(r.createdAt)}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {!claimed ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                claim(r.id);
                              }}
                              disabled={busyId === r.id}
                              className="leads-take-btn"
                            >
                              {busyId === r.id ? 'Tomando…' : 'Tomar'}
                            </button>
                          ) : (
                            <span className="leads-claimed-meta">
                              Tomado{r.claimedAt ? ` · ${relTime(r.claimedAt)}` : ''}
                            </span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <ul className="leads-cards">
            {filtered.map((r) => {
              const claimed = r.claimedAt !== null;
              return (
                <li key={r.id} className="leads-card" onClick={() => setSelected(r)}>
                  <div className="leads-card-top">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="leads-card-tipo">
                        {r.tipoEvento ?? 'Evento'} {r.pax ? `· ${r.pax} pax` : ''}
                      </div>
                      <div className="leads-card-name">{r.name ?? formatPhone(r.phone)}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <StatusBadge status={r.status} />
                      {r.urgente && <UrgentBadge />}
                    </div>
                  </div>
                  <div className="leads-card-meta">
                    {r.fechaTentativa && <span>📅 {r.fechaTentativa}</span>}
                    {r.presupuestoPp && <span>💰 {r.presupuestoPp}</span>}
                    {r.prioridad && <span style={{ textTransform: 'capitalize' }}>⭐ {r.prioridad}</span>}
                  </div>
                  <div className="leads-card-bottom">
                    <span className="leads-card-time">{relTime(r.createdAt)}</span>
                    {!claimed ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          claim(r.id);
                        }}
                        disabled={busyId === r.id}
                        className="leads-take-btn leads-take-btn--card"
                      >
                        {busyId === r.id ? 'Tomando…' : 'Tomar'}
                      </button>
                    ) : (
                      <span className="leads-card-claimed">
                        Tomado{r.claimedAt ? ` · ${relTime(r.claimedAt)}` : ''}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selected && (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onClaim={() => claim(selected.id)}
          claiming={busyId === selected.id}
        />
      )}
    </div>
  );
}

// ── Hero metrics banner ──────────────────────────────────────────────────────

function HeroMetrics({ metrics }: { metrics: Metrics }) {
  return (
    <div className="leads-hero">
      <div className="leads-hero-eyebrow">
        <span className="leads-hero-dot" />
        <span>Buzón de eventos</span>
      </div>

      <div className="leads-hero-stats">
        <HeroStat
          value={metrics.open}
          label="Sin tomar"
          accent={metrics.open > 0 ? 'gold' : undefined}
        />
        <HeroStat value={metrics.claimedToday} label="Tomados hoy" />
        <HeroStat value={metrics.week} label="Esta semana" />
        <HeroStat value={metrics.total} label="Total" />
      </div>

      {metrics.urgent > 0 && (
        <div className="leads-hero-urgent">
          <span className="leads-hero-urgent-flag" />
          <strong>{metrics.urgent}</strong> urgente{metrics.urgent === 1 ? '' : 's'} sin atender — responder pronto.
        </div>
      )}
    </div>
  );
}

function HeroStat({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: 'gold';
}) {
  return (
    <div className="leads-hero-stat">
      <span className={`leads-hero-stat-value${accent === 'gold' ? ' leads-hero-stat-value--gold' : ''}`}>
        {value}
      </span>
      <span className="leads-hero-stat-label">{label}</span>
    </div>
  );
}

// ── Table cells / badges ─────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.7rem 0.85rem',
        fontSize: '0.65rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <td
      className={className}
      style={{ padding: '0.85rem 0.85rem', color: 'var(--text-main)', verticalAlign: 'top', ...style }}
    >
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; border: string }> = {
    new: { bg: 'var(--green-light)', color: 'var(--green)', border: 'var(--green)' },
    claimed: { bg: 'rgba(37, 99, 235, 0.08)', color: 'var(--blue)', border: 'var(--blue)' },
    quoted: { bg: 'var(--gold-light)', color: 'var(--gold)', border: 'var(--gold)' },
    won: { bg: 'var(--green-light)', color: 'var(--green)', border: 'var(--green)' },
    lost: { bg: 'var(--bg-base)', color: 'var(--text-muted)', border: 'var(--panel-border)' },
  };
  const c = config[status] ?? config.lost;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function UrgentBadge() {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        background: 'var(--red-light)',
        color: 'var(--red)',
        border: '1px solid var(--red)',
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      Urgente
    </span>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ totalLeads, filter }: { totalLeads: number; filter: Filter }) {
  const isFiltered = totalLeads > 0;
  return (
    <div className="leads-empty">
      <p className="leads-empty-text">
        {!isFiltered
          ? 'Aún no llegan leads del bot.'
          : filter === 'open'
            ? 'Todos los leads están tomados. Buen trabajo.'
            : filter === 'urgent'
              ? 'No hay leads urgentes pendientes.'
              : 'Ningún lead coincide con este filtro.'}
      </p>
      {!isFiltered && (
        <p className="leads-empty-hint">
          Cuando un cliente complete el flujo de WhatsApp, aparece aquí y recibes una notificación.
        </p>
      )}
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

function LeadDrawer({
  lead,
  onClose,
  onClaim,
  claiming,
}: {
  lead: LeadRow;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
}) {
  const claimed = lead.claimedAt !== null;
  const waLink = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;

  return (
    <div onClick={onClose} className="leads-drawer-backdrop">
      <aside onClick={(e) => e.stopPropagation()} className="leads-drawer">
        <div className="leads-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="leads-drawer-eyebrow">
              <StatusBadge status={lead.status} />
              {lead.urgente && <UrgentBadge />}
            </div>
            <h2 className="leads-drawer-title">
              {lead.tipoEvento ? capitalize(lead.tipoEvento) : 'Evento'}
              {lead.pax ? ` · ${lead.pax} pax` : ''}
            </h2>
            <p className="leads-drawer-name">
              {lead.name ?? formatPhone(lead.phone)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="leads-drawer-close">
            ✕
          </button>
        </div>

        <dl className="leads-drawer-dl">
          <DlRow label="Tipo de evento" value={lead.tipoEvento ?? '—'} capitalize />
          <DlRow label="Personas" value={
            lead.pax !== null ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {lead.pax}
              </span>
            ) : '—'
          } />
          <DlRow label="Fecha tentativa" value={lead.fechaTentativa ?? '—'} />
          <DlRow label="Presupuesto / pax" value={
            lead.presupuestoPp ? (
              <span className="leads-money">{lead.presupuestoPp}</span>
            ) : '—'
          } />
          <DlRow label="Prioridad" value={lead.prioridad ?? '—'} capitalize />
          <DlRow label="Contacto" value={
            <a href={waLink} target="_blank" rel="noreferrer" className="leads-phone-link">
              {formatPhone(lead.phone)} ↗
            </a>
          } />
          <DlRow label="Recibido" value={formatFullDate(lead.createdAt)} />
          {claimed && lead.claimedAt && (
            <DlRow label="Tomado" value={formatFullDate(lead.claimedAt)} />
          )}
          <DlRow label="Origen" value={
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {lead.source}
            </span>
          } />
        </dl>

        {lead.notasExtra && (
          <div className="leads-drawer-block">
            <span className="section-label">Notas adicionales</span>
            <p className="leads-drawer-notes">{lead.notasExtra}</p>
          </div>
        )}

        <div className="leads-drawer-block">
          <span className="section-label">Conversación</span>
          <pre className="leads-drawer-transcript">
            {lead.rawConversation ?? '(sin transcripción)'}
          </pre>
        </div>

        <div className="leads-drawer-actions">
          {!claimed && (
            <button
              onClick={onClaim}
              disabled={claiming}
              className="leads-drawer-action leads-drawer-action--primary"
            >
              {claiming ? 'Tomando…' : 'Tomar lead'}
            </button>
          )}
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className={`leads-drawer-action ${claimed ? 'leads-drawer-action--primary' : 'leads-drawer-action--outline'}`}
          >
            Abrir WhatsApp ↗
          </a>
        </div>
      </aside>
    </div>
  );
}

function DlRow({
  label,
  value,
  capitalize: cap,
}: {
  label: string;
  value: React.ReactNode;
  capitalize?: boolean;
}) {
  return (
    <div className="leads-dl-row">
      <dt>{label}</dt>
      <dd style={cap ? { textTransform: 'capitalize' } : undefined}>{value}</dd>
    </div>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+52 ${digits.slice(2, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Styles ───────────────────────────────────────────────────────────────────

const LEADS_CSS = `
/* ───────────────────────────────────────────────────────────────
   Leads — Editorial Brutalist surface
   Aligned with globals.css :root tokens and GuestsTable.tsx.
   ─────────────────────────────────────────────────────────────── */

.leads-root { padding: 0; }

/* ── Hero metrics banner — mirrors .impact-wrapper / Guests hero ── */
.leads-hero {
  background: var(--text-main);
  color: #fff;
  padding: 2.5rem 2.5rem 2rem;
  position: relative;
  border-bottom: 1px solid var(--text-main);
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.05s;
}

.leads-hero-eyebrow {
  position: absolute;
  top: 1rem;
  right: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}
.leads-hero-dot {
  width: 7px;
  height: 7px;
  background: var(--gold);
  flex-shrink: 0;
}

.leads-hero-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: stretch;
}
.leads-hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  text-align: center;
  padding: 0 1rem;
  border-right: 1px solid rgba(255,255,255,0.1);
}
.leads-hero-stat:last-child { border-right: none; }
.leads-hero-stat-value {
  font-family: var(--font-serif);
  font-size: 5rem;
  font-weight: 600;
  color: #fff;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  display: block;
}
.leads-hero-stat-value--gold { color: var(--gold); }
.leads-hero-stat-label {
  margin-top: 0.7rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}

.leads-hero-urgent {
  margin-top: 1.5rem;
  padding-top: 1.1rem;
  border-top: 1px solid rgba(255,255,255,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  font-size: 0.78rem;
  color: rgba(255,255,255,0.7);
}
.leads-hero-urgent strong { color: var(--red); font-weight: 700; }
.leads-hero-urgent-flag {
  width: 7px;
  height: 7px;
  background: var(--red);
  animation: leads-urgent-pulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes leads-urgent-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

/* ── Header ──────────────────────────────────────────────────── */
.leads-header {
  padding: 1.5rem 2.5rem 0;
  margin-bottom: 1.25rem;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.1s;
}
.leads-header-inner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.leads-title {
  font-family: var(--font-serif);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 0;
  letter-spacing: -0.02em;
}
.leads-subtitle {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0.3rem 0 0;
}
.leads-subtitle-meta { color: var(--text-main); }
.leads-urgent-count { color: var(--red); font-weight: 700; }

/* ── Filter bar ──────────────────────────────────────────────── */
.leads-filterbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 2.5rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.15s;
}
.leads-filters {
  display: flex;
  gap: 0;
  flex-wrap: wrap;
  flex: 0 1 auto;
}
.leads-filter-btn {
  padding: 0.5rem 1rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--text-main);
  border-right-width: 0;
  background: var(--panel-bg);
  color: var(--text-main);
  cursor: pointer;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.leads-filter-btn:last-child { border-right-width: 1px; }
.leads-filter-btn:hover { background: var(--bg-base); }
.leads-filter-btn.active {
  background: var(--text-main);
  color: var(--panel-bg);
}
.leads-filter-count {
  display: inline-block;
  font-size: 0.65rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  padding: 1px 6px;
  background: var(--bg-base);
  color: var(--text-main);
  border: 1px solid currentColor;
  letter-spacing: 0;
}
.leads-filter-btn.active .leads-filter-count {
  background: var(--panel-bg);
  color: var(--text-main);
  border-color: var(--panel-bg);
}
.leads-search {
  margin-left: auto;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--text-main);
  font-size: 0.85rem;
  font-family: inherit;
  width: 280px;
  background: var(--panel-bg);
  outline: none;
  border-radius: 0;
}
.leads-search:focus { box-shadow: var(--shadow-md); }

/* ── Table ───────────────────────────────────────────────────── */
.leads-table-wrap {
  border: 1px solid var(--text-main);
  background: var(--panel-bg);
  overflow: auto;
  margin: 0 2.5rem 2.5rem;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.2s;
}
.leads-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.leads-table thead tr {
  background: var(--bg-base);
  border-bottom: 1px solid var(--text-main);
}
.leads-row {
  border-bottom: 1px solid var(--panel-border);
  cursor: pointer;
  background: var(--panel-bg);
  transition: background 0.12s;
}
.leads-row:last-child { border-bottom: none; }
.leads-row:hover { background: var(--bg-base); }
.leads-row-focus {
  background: var(--gold-light);
}
.leads-row-focus:hover {
  background: var(--gold-light);
}
.leads-row-focus td:first-child {
  border-left: 3px solid var(--gold);
}

.leads-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.leads-money {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.82rem;
  color: var(--text-main);
}

.leads-phone-link {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-decoration: none;
  border-bottom: 1px dotted var(--text-dim);
}
.leads-phone-link:hover {
  color: var(--green);
  border-bottom-color: var(--green);
}

.leads-take-btn {
  padding: 0.5rem 1.1rem;
  background: var(--text-main);
  color: var(--panel-bg);
  border: 1px solid var(--text-main);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s ease;
  border-radius: 0;
}
.leads-take-btn:hover:not(:disabled) {
  background: var(--gold);
  border-color: var(--gold);
}
.leads-take-btn:disabled {
  background: var(--text-muted);
  border-color: var(--text-muted);
  cursor: wait;
}
.leads-claimed-meta {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
}

/* ── Mobile cards ────────────────────────────────────────────── */
.leads-cards { display: none; list-style: none; padding: 0; margin: 0; }

/* ── Empty ───────────────────────────────────────────────────── */
.leads-empty {
  border: 1px solid var(--text-main);
  background: var(--panel-bg);
  padding: 3rem 1.5rem;
  text-align: center;
  margin: 0 2.5rem 2.5rem;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.2s;
}
.leads-empty-text {
  margin: 0;
  font-size: 1rem;
  font-family: var(--font-serif);
  color: var(--text-main);
  letter-spacing: -0.01em;
}
.leads-empty-hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* ── Drawer ──────────────────────────────────────────────────── */
.leads-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17,17,17,0.45);
  display: flex;
  justify-content: flex-end;
  z-index: 100;
  animation: fadeIn 0.15s ease;
}
.leads-drawer {
  width: 100%;
  max-width: 480px;
  background: var(--panel-bg);
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid var(--text-main);
  padding: 1.75rem 1.5rem 2.5rem;
  box-sizing: border-box;
  animation: leads-drawer-slide 0.22s ease;
}
@keyframes leads-drawer-slide {
  from { transform: translateX(20px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

.leads-drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--text-main);
  margin-bottom: 1.25rem;
}
.leads-drawer-eyebrow {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.65rem;
}
.leads-drawer-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-main);
  letter-spacing: -0.02em;
  line-height: 1.15;
  text-transform: capitalize;
}
.leads-drawer-name {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.leads-drawer-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 0.35rem;
  line-height: 1;
}
.leads-drawer-close:hover { color: var(--text-main); }

.leads-drawer-dl {
  margin: 0 0 1.5rem;
  padding: 0;
  font-size: 0.85rem;
  color: var(--text-main);
}
.leads-dl-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--panel-border);
  gap: 0.75rem;
}
.leads-dl-row:last-child { border-bottom: none; }
.leads-dl-row dt {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  flex-shrink: 0;
}
.leads-dl-row dd {
  margin: 0;
  text-align: right;
  max-width: 65%;
  word-break: break-word;
}

.leads-drawer-block { margin-bottom: 1.25rem; }
.leads-drawer-block .section-label { display: block; margin-bottom: 0.5rem; }
.leads-drawer-notes {
  margin: 0;
  padding: 0.75rem 0.85rem;
  background: var(--bg-base);
  border: 1px solid var(--panel-border);
  font-size: 0.85rem;
  color: var(--text-main);
  line-height: 1.5;
  white-space: pre-wrap;
}
.leads-drawer-transcript {
  margin: 0;
  padding: 0.85rem 0.95rem;
  background: var(--bg-base);
  border: 1px solid var(--text-main);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--text-main);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
  border-radius: 0;
}

.leads-drawer-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.leads-drawer-action {
  flex: 1 1 calc(50% - 0.25rem);
  padding: 0.85rem;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  border-radius: 0;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
  border: 1px solid var(--text-main);
}
.leads-drawer-action--primary {
  background: var(--text-main);
  color: var(--panel-bg);
}
.leads-drawer-action--primary:hover { background: #333; color: var(--panel-bg); }
.leads-drawer-action--outline {
  background: var(--panel-bg);
  color: var(--text-main);
}
.leads-drawer-action--outline:hover {
  background: var(--text-main);
  color: var(--panel-bg);
}
.leads-drawer-action:disabled {
  background: var(--text-muted);
  border-color: var(--text-muted);
  cursor: wait;
}

/* ── 1440px+ TV / large desktop ──────────────────────────────── */
@media (min-width: 1440px) {
  .leads-hero { padding: 3rem 3rem 2.5rem; }
  .leads-hero-stat-value { font-size: 6rem; }
  .leads-hero-stat-label { font-size: 0.7rem; letter-spacing: 0.22em; }
  .leads-header,
  .leads-filterbar { padding-left: 3rem; padding-right: 3rem; }
  .leads-table-wrap, .leads-empty { margin-left: 3rem; margin-right: 3rem; }
}

/* ── ≤1024px iPad ─────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .leads-hero { padding: 2rem 1.5rem 1.75rem; }
  .leads-hero-stat-value { font-size: 3.5rem; }
  .leads-table { font-size: 0.8rem; }
  .leads-table th, .leads-table td { padding: 0.6rem 0.7rem !important; }
  .leads-search { width: 220px; font-size: 16px; }
  .leads-table-wrap, .leads-empty { margin-left: 1.5rem; margin-right: 1.5rem; }
  .leads-filterbar { padding: 0 1.5rem; }
  .leads-header { padding: 1.25rem 1.5rem 0; }
  .leads-title { font-size: 1.5rem; }
}

/* ── ≤640px phone ─────────────────────────────────────────────── */
@media (max-width: 640px) {
  .leads-hero { padding: 1.75rem 1rem 1.5rem; }
  .leads-hero-stats { grid-template-columns: repeat(2, 1fr); }
  .leads-hero-stat {
    padding: 0.85rem 0.5rem;
    border-right: 1px solid rgba(255,255,255,0.1);
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .leads-hero-stat:nth-child(2) { border-right: none; }
  .leads-hero-stat:nth-child(3),
  .leads-hero-stat:nth-child(4) { border-bottom: none; }
  .leads-hero-stat-value { font-size: 2.75rem; }
  .leads-hero-stat-label { font-size: 0.58rem; letter-spacing: 0.14em; margin-top: 0.45rem; }
  .leads-hero-urgent { font-size: 0.72rem; gap: 0.45rem; margin-top: 1.2rem; padding-top: 1rem; }
  .leads-hero-eyebrow { font-size: 0.55rem; top: 0.75rem; right: 1rem; }

  .leads-header { padding: 1rem 1rem 0; }
  .leads-title { font-size: 1.3rem; }
  .leads-subtitle { font-size: 0.75rem; }
  .leads-header-inner { flex-direction: column; align-items: stretch; gap: 0.7rem; }

  .leads-filterbar { padding: 0 1rem; gap: 0.6rem; flex-direction: column; align-items: stretch; }
  .leads-filters { width: 100%; }
  .leads-filter-btn { flex: 1 1 calc(50% - 0.2rem); font-size: 0.66rem; padding: 0.55rem 0.5rem; border-right-width: 1px; border-bottom-width: 0; justify-content: center; }
  .leads-filter-btn:nth-last-child(-n+2) { border-bottom-width: 1px; }
  .leads-search { margin-left: 0; width: 100%; font-size: 16px; padding: 0.7rem 0.75rem; }

  .leads-table-wrap { display: none; }
  .leads-empty { margin: 0 1rem 1.5rem; padding: 2.25rem 1rem; }

  .leads-cards {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0 1rem 1.5rem;
  }
  .leads-card {
    background: var(--panel-bg);
    border: 1px solid var(--text-main);
    padding: 0.95rem 1rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    transition: box-shadow 0.15s ease;
  }
  .leads-card:active { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .leads-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .leads-card-tipo {
    font-family: var(--font-serif);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-main);
    letter-spacing: -0.01em;
    text-transform: capitalize;
    line-height: 1.2;
  }
  .leads-card-name {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .leads-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 0.95rem;
    font-size: 0.74rem;
    color: var(--text-muted);
  }
  .leads-card-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-top: 1px solid var(--panel-border);
    padding-top: 0.65rem;
  }
  .leads-card-time {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .leads-card-claimed {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-weight: 600;
  }
  .leads-take-btn--card { padding: 0.4rem 0.85rem; font-size: 0.66rem; }

  .leads-drawer { max-width: 100%; padding: 1.25rem 1.1rem 2.25rem; }
  .leads-drawer-title { font-size: 1.3rem; }
  .leads-drawer-actions { flex-direction: column; }
  .leads-drawer-action { flex-basis: 100%; }
}
`;

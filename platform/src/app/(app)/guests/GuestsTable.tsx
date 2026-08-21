'use client';

import { useMemo, useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { track } from '@/lib/analytics-client';

interface GuestRow {
  id: number;
  name: string;
  whatsapp: string;
  birthdayMmdd: string | null;
  preferences: string[] | null;
  marketingConsent: boolean;
  status: 'pending_validation' | 'validated' | 'expired';
  validationCode: string | null;
  redemptionType: string | null;
  promoType: string | null;
  capturedAt: string;
  validatedAt: string | null;
  notes: string | null;
  visitCount: number;
  lastVisit: string | null;
}

interface Metrics {
  total: number;
  validated: number;
  activeStaff: number;
  copaVino: number;
  postre: number;
  otro: number;
  hoursInOperation: number;
  leaderboard: { name: string; count: number }[];
}

export type Filter = 'all' | 'today' | 'birthdays' | 'absent60' | 'vip';

const FILTER_LABELS: Record<Filter, string> = {
  today: 'Cumple hoy',
  all: 'Todos',
  birthdays: 'Cumple este mes',
  absent60: 'Sin venir 60 días',
  vip: 'VIP (5+ visitas)',
};

export default function GuestsTable({
  guests,
  restaurantName,
  brand,
  slug,
  metrics: initialMetrics,
  todayMmdd,
  initialFilter,
}: {
  guests: GuestRow[];
  restaurantName: string;
  brand: string;
  slug: string;
  metrics: Metrics;
  todayMmdd: string;
  initialFilter?: Filter;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(initialFilter ?? 'all');

  // Wrap setFilter so every filter change is a product event.
  const changeFilter = useCallback((f: Filter) => {
    setFilter((prev) => {
      if (prev !== f) track('guest_filter_changed', { filter: f });
      return f;
    });
  }, []);

  // Landing with a deep-linked filter (?filter=today from the daily-digest
  // push) counts as a filter change too — record it once on mount.
  useEffect(() => {
    if (initialFilter && initialFilter !== 'all') {
      track('guest_filter_changed', { filter: initialFilter });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectGuest = useCallback((g: GuestRow | null) => {
    if (g) track('guest_profile_opened', { guest_id: g.id });
    setSelected(g);
  }, []);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GuestRow | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<Metrics>(initialMetrics);
  const [justUpdated, setJustUpdated] = useState(false);
  const prevTotalRef = useRef<number>(initialMetrics.total);

  // Per-day "contacted" marks so a guest's WhatsApp button turns into a muted
  // "Enviado ✓" once the message has been opened today. Resets each day
  // because the localStorage key embeds today's DD/MM (Mexico City).
  const contactedKey = `guests-contacted-${todayMmdd}`;
  const readContactedRaw = useCallback(
    () => localStorage.getItem(contactedKey) ?? '[]',
    [contactedKey],
  );
  const contactedRaw = useSyncExternalStore(subscribeContacted, readContactedRaw, () => '[]');
  const contacted = useMemo<number[]>(() => {
    try {
      const parsed = JSON.parse(contactedRaw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [contactedRaw]);

  const markContacted = (id: number) => {
    if (contacted.includes(id)) return;
    try {
      localStorage.setItem(contactedKey, JSON.stringify([...contacted, id]));
    } catch {
      // ignore quota/privacy errors
    }
    window.dispatchEvent(new Event(CONTACTED_EVENT));
  };

  const todayCount = useMemo(
    () => guests.filter((g) => g.birthdayMmdd === todayMmdd).length,
    [guests, todayMmdd],
  );

  // Poll the lightweight stats endpoint every 15 s.
  // When the total ticks up the hero number briefly turns green — the "magic
  // moment" of the pitch when Don Carlos sees a live validation happen.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/guests/stats', { cache: 'no-store' });
        if (!res.ok) return;
        const data: Omit<Metrics, 'leaderboard'> = await res.json();
        setLiveMetrics((prev) => ({
          ...prev,
          total: data.total,
          validated: data.validated,
          activeStaff: data.activeStaff,
          copaVino: data.copaVino,
          postre: data.postre,
          otro: data.otro,
          hoursInOperation: data.hoursInOperation,
        }));
        if (data.total !== prevTotalRef.current) {
          prevTotalRef.current = data.total;
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 2500);
        }
      } catch {
        // silent — no toast during a live demo
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const now = new Date();
    const thisMonth = String(now.getMonth() + 1).padStart(2, '0');
    const cutoff60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const q = search.trim().toLowerCase();

    return guests.filter((g) => {
      if (filter === 'today') {
        if (g.birthdayMmdd !== todayMmdd) return false;
      } else if (filter === 'birthdays') {
        const mm = g.birthdayMmdd?.split('/')[1];
        if (mm !== thisMonth) return false;
      } else if (filter === 'absent60') {
        if (!g.lastVisit) return false;
        if (new Date(g.lastVisit) > cutoff60) return false;
      } else if (filter === 'vip') {
        if (g.visitCount < 5) return false;
      }
      if (q) {
        const hay = `${g.name} ${g.whatsapp}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [guests, filter, search, todayMmdd]);

  const captureUrl = `/g/${slug}`;

  return (
    <div className="guests-root">
      <style>{GUESTS_CSS}</style>

      {/* ── Hero metrics banner ─────────────────────────────────────── */}
      <HeroMetrics metrics={liveMetrics} justUpdated={justUpdated} />

      {/* ── Top meseros leaderboard ─────────────────────────────────── */}
      {liveMetrics.leaderboard.length > 0 && (
        <Leaderboard entries={liveMetrics.leaderboard} />
      )}

      {/* ── Header: title + actions ─────────────────────────────────── */}
      <header className="guests-header">
        <div className="guests-header-inner">
          <div>
            <h1 className="guests-title">Club VIP</h1>
            <p className="guests-subtitle">
              {restaurantName} ·{' '}
              <a href={captureUrl} target="_blank" rel="noreferrer">
                Ver página de captura →
              </a>
            </p>
          </div>

          <div className="guests-actions">
            <select
              disabled
              title="Disponible en el plan Multi-marca (Enterprise)"
              className="guests-brand-select"
            >
              <option>{brand ? brand.toUpperCase() : 'Una marca'} — Próximamente multi-marca</option>
            </select>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/v1/guests/export"
              className="guests-export-btn"
              onClick={() => track('csv_export', { feature: 'guests' })}
            >
              Exportar CSV
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/guests/print"
              target="_blank"
              rel="noreferrer"
              className="guests-export-btn guests-export-btn--solid"
            >
              Descargar PDF
            </a>
          </div>
        </div>
      </header>

      {/* ── Filter bar + search ─────────────────────────────────────── */}
      <div className="guests-filterbar">
        <div className="guests-filters">
          {(['today', 'all', 'birthdays', 'absent60', 'vip'] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => changeFilter(f)}
                className={`guests-filter-btn${active ? ' active' : ''}`}
              >
                {f === 'today' && todayCount > 0
                  ? `${FILTER_LABELS[f]} · ${todayCount}`
                  : FILTER_LABELS[f]}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre o WhatsApp…"
          className="guests-search"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          captureUrl={captureUrl}
          guestsTotal={guests.length}
          activeFilter={filter}
        />
      ) : (
        <>
          {/* Desktop / iPad: table */}
          <div className="guests-table-wrap">
            <table className="guests-table">
              <thead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>WhatsApp</Th>
                  <Th>Cumple</Th>
                  <Th>Preferencias</Th>
                  <Th>Visitas</Th>
                  <Th>Última visita</Th>
                  <Th>Estado</Th>
                  <Th>Enviar</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.id} onClick={() => selectGuest(g)} className="guests-row">
                    <Td>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{g.name}</div>
                      {g.visitCount >= 5 && <VipBadge />}
                    </Td>
                    <Td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: '0.78rem',
                      }}
                    >
                      {formatPhone(g.whatsapp)}
                    </Td>
                    <Td>{g.birthdayMmdd ?? '—'}</Td>
                    <Td>
                      {g.preferences && g.preferences.length > 0 ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {g.preferences.join(', ')}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </Td>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{g.visitCount}</Td>
                    <Td style={{ color: 'var(--text-muted)' }}>{g.lastVisit ? formatRelative(g.lastVisit) : '—'}</Td>
                    <Td>
                      <StatusBadge status={g.status} />
                    </Td>
                    <Td>
                      <WhatsAppButton
                        guest={g}
                        restaurantName={restaurantName}
                        todayMmdd={todayMmdd}
                        sent={contacted.includes(g.id)}
                        onSent={markContacted}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <ul className="guests-cards">
            {filtered.map((g) => (
              <li key={g.id} className="guests-card" onClick={() => selectGuest(g)}>
                <div className="guests-card-top">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="guests-card-name">{g.name}</div>
                    <div className="guests-card-phone">{formatPhone(g.whatsapp)}</div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                    }}
                  >
                    <StatusBadge status={g.status} />
                    {g.visitCount >= 5 && <VipBadge />}
                  </div>
                </div>
                <div className="guests-card-meta">
                  <span>
                    <strong>{g.visitCount}</strong> visitas
                  </span>
                  {g.birthdayMmdd && <span>🎂 {g.birthdayMmdd}</span>}
                  {g.lastVisit && <span>Última: {formatRelative(g.lastVisit)}</span>}
                </div>
                {g.preferences && g.preferences.length > 0 && (
                  <div className="guests-card-prefs">{g.preferences.join(' · ')}</div>
                )}
                <WhatsAppButton
                  guest={g}
                  restaurantName={restaurantName}
                  todayMmdd={todayMmdd}
                  sent={contacted.includes(g.id)}
                  onSent={markContacted}
                  block
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <GuestDrawer
          guest={selected}
          restaurantName={restaurantName}
          todayMmdd={todayMmdd}
          contacted={contacted.includes(selected.id)}
          onSent={markContacted}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Hero metrics banner ──────────────────────────────────────────────────────

function HeroMetrics({
  metrics,
  justUpdated,
}: {
  metrics: Metrics;
  justUpdated: boolean;
}) {
  const hoursLabel =
    metrics.hoursInOperation < 72
      ? `${metrics.hoursInOperation}h`
      : `${Math.round(metrics.hoursInOperation / 24)}d`;

  return (
    <div className="hero-banner">
      <div className="hero-live">
        <span className="hero-live-dot" />
        <span>En vivo</span>
      </div>

      <div className="hero-stats">
        <HeroStat value={metrics.total} label="Invitados" highlight={justUpdated} />
        <HeroStat value={metrics.activeStaff} label="Meseros" />
        <HeroStat value={hoursLabel} label="En operación" />
        <HeroStat value={metrics.validated} label="Cortesías" />
      </div>

      {metrics.validated > 0 && (
        <div className="hero-split">
          <span><strong>{metrics.validated}</strong> cortesías entregadas</span>
          {metrics.copaVino > 0 && (
            <>
              <span className="hero-dot">·</span>
              <span><strong>{metrics.copaVino}</strong> copa de vino</span>
            </>
          )}
          {metrics.postre > 0 && (
            <>
              <span className="hero-dot">·</span>
              <span><strong>{metrics.postre}</strong> postre</span>
            </>
          )}
          {metrics.otro > 0 && (
            <>
              <span className="hero-dot">·</span>
              <span><strong>{metrics.otro}</strong> otro</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HeroStat({
  value,
  label,
  highlight,
}: {
  value: string | number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="hero-stat">
      <span className={`hero-stat-value${highlight ? ' hero-stat-highlight' : ''}`}>
        {value}
      </span>
      <span className="hero-stat-label">{label}</span>
    </div>
  );
}

// ── Top meseros leaderboard ──────────────────────────────────────────────────

function Leaderboard({ entries }: { entries: { name: string; count: number }[] }) {
  return (
    <div className="leaderboard-bar">
      <span className="leaderboard-heading">Top Meseros</span>
      <div className="leaderboard-entries">
        {entries.map((e, i) => (
          <div key={i} className="leaderboard-entry">
            <span className="leaderboard-rank">{i + 1}</span>
            <span className="leaderboard-name">{e.name}</span>
            <span className="leaderboard-count">{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

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
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td style={{ padding: '0.75rem 0.85rem', color: 'var(--text-main)', ...style }}>
      {children}
    </td>
  );
}

function VipBadge() {
  return (
    <span
      style={{
        display: 'inline-block',
        marginTop: 2,
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        background: 'var(--gold-light)',
        color: 'var(--gold)',
        border: '1px solid var(--gold)',
        padding: '1px 6px',
      }}
    >
      VIP
    </span>
  );
}

function StatusBadge({ status }: { status: GuestRow['status'] }) {
  const styles: Record<GuestRow['status'], React.CSSProperties> = {
    pending_validation: {
      background: 'var(--gold-light)',
      color: 'var(--gold)',
      border: '1px solid var(--gold)',
    },
    validated: {
      background: 'var(--green-light)',
      color: 'var(--green)',
      border: '1px solid var(--green)',
    },
    expired: {
      background: 'var(--bg-base)',
      color: 'var(--text-muted)',
      border: '1px solid var(--panel-border)',
    },
  };
  const labels: Record<GuestRow['status'], string> = {
    pending_validation: 'Pendiente',
    validated: 'Validado',
    expired: 'Expirado',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        ...styles[status],
      }}
    >
      {labels[status]}
    </span>
  );
}

function EmptyState({
  captureUrl,
  guestsTotal,
  activeFilter,
}: {
  captureUrl: string;
  guestsTotal: number;
  activeFilter: Filter;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--text-main)',
        background: 'var(--panel-bg)',
        padding: '3rem 1.5rem',
        textAlign: 'center',
        color: 'var(--text-muted)',
        margin: '0 2.5rem',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.95rem',
          fontFamily: 'var(--font-serif)',
          color: 'var(--text-main)',
          letterSpacing: '-0.01em',
        }}
      >
        {guestsTotal === 0
          ? 'Aún no has capturado invitados.'
          : activeFilter === 'today'
            ? 'Nadie cumple años hoy.'
            : 'Ningún invitado coincide con este filtro.'}
      </p>
      {guestsTotal === 0 && (
        <a
          href={captureUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            marginTop: '1rem',
            padding: '0.6rem 1.1rem',
            border: '1px solid var(--text-main)',
            background: 'var(--text-main)',
            color: 'var(--panel-bg)',
            textDecoration: 'none',
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Abrir página de captura
        </a>
      )}
    </div>
  );
}

// ── Guest detail drawer ──────────────────────────────────────────────────────

function GuestDrawer({
  guest,
  restaurantName,
  todayMmdd,
  contacted,
  onSent,
  onClose,
  onSaved,
}: {
  guest: GuestRow;
  restaurantName: string;
  todayMmdd: string;
  contacted: boolean;
  onSent: (id: number) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(guest.name);
  const [whatsapp, setWhatsapp] = useState(guest.whatsapp);
  const [birthdayMmdd, setBirthdayMmdd] = useState(guest.birthdayMmdd ?? '');
  const [notes, setNotes] = useState(guest.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [visiting, setVisiting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { notes };
      if (editing) {
        if (name.trim() && name.trim() !== guest.name) payload.name = name.trim();
        if (whatsapp.trim() && whatsapp.trim() !== guest.whatsapp)
          payload.whatsapp = whatsapp.trim();
        if (birthdayMmdd.trim() !== (guest.birthdayMmdd ?? '')) {
          payload.birthdayMmdd = birthdayMmdd.trim();
        }
      }
      const res = await fetch(`/api/v1/guests/${guest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'No se pudo guardar');
        return;
      }
      onSaved();
    } catch {
      setError('Sin conexión');
    } finally {
      setSaving(false);
    }
  };

  const logVisit = async () => {
    setError(null);
    setVisiting(true);
    try {
      const res = await fetch(`/api/v1/guests/${guest.id}/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError('No se pudo registrar la visita');
        return;
      }
      onSaved();
    } catch {
      setError('Sin conexión');
    } finally {
      setVisiting(false);
    }
  };

  const remove = async () => {
    if (!confirm(`¿Eliminar a ${guest.name}? Esta acción no se puede deshacer.`)) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/guests/${guest.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'No se pudo eliminar');
        return;
      }
      onSaved();
    } catch {
      setError('Sin conexión');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17,17,17,0.4)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 100,
      }}
    >
      <aside onClick={(e) => e.stopPropagation()} className="guests-drawer">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1.25rem',
            paddingBottom: '1rem',
            borderBottom: '1px solid var(--text-main)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                style={{
                  width: '100%',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  fontFamily: 'var(--font-serif)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--text-main)',
                  padding: '0.4rem 0.55rem',
                  borderRadius: 0,
                  outline: 'none',
                }}
              />
            ) : (
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-serif)',
                  fontSize: '1.4rem',
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                }}
              >
                {guest.name}
              </h2>
            )}
            {editing ? (
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                maxLength={20}
                placeholder="WhatsApp"
                style={{
                  marginTop: 6,
                  width: '100%',
                  fontSize: '0.82rem',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  border: '1px solid var(--text-main)',
                  padding: '0.4rem 0.5rem',
                  borderRadius: 0,
                  outline: 'none',
                }}
              />
            ) : (
              <p
                style={{
                  margin: '0.35rem 0 0',
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatPhone(guest.whatsapp)}
              </p>
            )}
          </div>
          <WhatsAppButton
            guest={guest}
            restaurantName={restaurantName}
            todayMmdd={todayMmdd}
            sent={contacted}
            onSent={onSent}
          />
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0 0.35rem',
              marginLeft: 8,
              lineHeight: 1,
            }}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <dl style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--text-main)' }}>
          {editing ? (
            <DlRow
              label="Cumpleaños"
              value={
                <input
                  value={birthdayMmdd}
                  onChange={(e) => setBirthdayMmdd(e.target.value)}
                  maxLength={5}
                  placeholder="DD/MM"
                  style={{
                    width: 92,
                    textAlign: 'right',
                    fontSize: '0.82rem',
                    border: '1px solid var(--text-main)',
                    padding: '0.25rem 0.45rem',
                    fontFamily: 'inherit',
                    borderRadius: 0,
                    outline: 'none',
                  }}
                />
              }
            />
          ) : (
            <DlRow label="Cumpleaños" value={guest.birthdayMmdd ?? '—'} />
          )}
          <DlRow label="Preferencias" value={guest.preferences?.join(', ') || '—'} />
          <DlRow
            label="Visitas"
            value={
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}
              >
                {guest.visitCount}
              </span>
            }
          />
          <DlRow label="Primera captura" value={formatDate(guest.capturedAt)} />
          <DlRow
            label="Última visita"
            value={guest.lastVisit ? formatDate(guest.lastVisit) : '—'}
          />
          <DlRow label="Estado" value={<StatusBadge status={guest.status} />} />
          {guest.status === 'pending_validation' && guest.validationCode && (
            <DlRow
              label="Código"
              value={
                <code
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    background: 'var(--bg-base)',
                    border: '1px solid var(--text-main)',
                    padding: '2px 8px',
                    letterSpacing: '0.05em',
                  }}
                >
                  {guest.validationCode}
                </code>
              }
            />
          )}
          {guest.redemptionType && (
            <DlRow label="Entrega" value={guest.redemptionType.replace('_', ' ')} />
          )}
          {guest.marketingConsent && (
            <DlRow label="Consentimiento WhatsApp" value="Sí" />
          )}
        </dl>

        <div style={{ marginBottom: '1.25rem' }}>
          <label
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              display: 'block',
              marginBottom: '0.4rem',
            }}
          >
            Notas internas
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Alergias, celebraciones, preferencias de mesa, etc."
            style={{
              width: '100%',
              padding: '0.65rem 0.7rem',
              border: '1px solid var(--text-main)',
              fontSize: '0.85rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              borderRadius: 0,
              background: 'var(--panel-bg)',
            }}
          />
        </div>

        {error && (
          <div
            style={{
              background: 'var(--red-light)',
              border: '1px solid var(--red)',
              color: 'var(--red)',
              padding: '0.55rem 0.75rem',
              fontSize: '0.78rem',
              marginBottom: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={save}
            disabled={saving || deleting}
            style={{
              flex: '1 1 45%',
              padding: '0.8rem',
              background: saving ? 'var(--text-muted)' : 'var(--text-main)',
              color: 'var(--panel-bg)',
              border: '1px solid var(--text-main)',
              fontWeight: 600,
              fontSize: '0.72rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              cursor: saving ? 'wait' : 'pointer',
              borderRadius: 0,
            }}
          >
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar notas'}
          </button>
          <button
            onClick={logVisit}
            disabled={visiting || deleting}
            style={{
              flex: '1 1 45%',
              padding: '0.8rem',
              background: 'var(--panel-bg)',
              color: 'var(--text-main)',
              border: '1px solid var(--text-main)',
              fontWeight: 600,
              fontSize: '0.72rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              cursor: visiting ? 'wait' : 'pointer',
              borderRadius: 0,
            }}
          >
            {visiting ? 'Registrando…' : '+ Visita'}
          </button>
          <button
            onClick={() => {
              if (editing) {
                setName(guest.name);
                setWhatsapp(guest.whatsapp);
                setBirthdayMmdd(guest.birthdayMmdd ?? '');
              }
              setEditing(!editing);
              setError(null);
            }}
            disabled={saving || deleting}
            style={{
              flex: '1 1 45%',
              padding: '0.7rem',
              background: editing ? 'var(--bg-base)' : 'var(--panel-bg)',
              color: 'var(--text-main)',
              border: '1px solid var(--panel-border)',
              fontWeight: 600,
              fontSize: '0.7rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              cursor: 'pointer',
              borderRadius: 0,
            }}
          >
            {editing ? 'Cancelar' : 'Editar datos'}
          </button>
          <button
            onClick={remove}
            disabled={deleting || saving}
            style={{
              flex: '1 1 45%',
              padding: '0.7rem',
              background: 'var(--panel-bg)',
              color: 'var(--red)',
              border: '1px solid var(--red)',
              fontWeight: 600,
              fontSize: '0.7rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              cursor: deleting ? 'wait' : 'pointer',
              borderRadius: 0,
            }}
          >
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function DlRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--panel-border)',
        gap: '0.75rem',
      }}
    >
      <dt
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, textAlign: 'right', maxWidth: '65%' }}>{value}</dd>
    </div>
  );
}

// ── WhatsApp send button ──────────────────────────────────────────────────────

// Minimal localStorage-backed store: components re-read the "contacted" list
// when another click updates it (same tab) or another tab writes (storage).
const CONTACTED_EVENT = 'guests-contacted-changed';

function subscribeContacted(onChange: () => void): () => void {
  window.addEventListener(CONTACTED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CONTACTED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const WhatsAppIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
);

function WhatsAppButton({
  guest,
  restaurantName,
  todayMmdd,
  sent,
  onSent,
  block,
}: {
  guest: GuestRow;
  restaurantName: string;
  todayMmdd: string;
  sent: boolean;
  onSent: (id: number) => void;
  block?: boolean;
}) {
  return (
    <a
      href={waUrl(guest, todayMmdd, restaurantName)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        track('guest_whatsapp_link_click', {
          guest_id: guest.id,
          kind: guest.birthdayMmdd === todayMmdd ? 'birthday' : 'generic',
        });
        onSent(guest.id);
      }}
      aria-label={`Enviar WhatsApp a ${firstName(guest.name)}`}
      className={`guests-wa-btn${sent ? ' guests-wa-btn--sent' : ''}${block ? ' guests-wa-btn--block' : ''}`}
    >
      {WhatsAppIcon}
      {sent ? 'Enviado ✓' : 'WhatsApp'}
    </a>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────────

function firstName(value: string): string {
  const first = value.trim().split(/\s+/)[0] || '';
  if (!first) return value.trim();
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Birthday-of-the-day guests get the copa-de-vino invitation; everyone else
// gets a plain greeting. Names are stored in caps ("QUINTIN Morgado"), so the
// first token is Title-cased before going into the message.
function messageFor(g: GuestRow, todayMmdd: string, restaurantName: string): string {
  if (g.birthdayMmdd === todayMmdd) {
    return `¡Feliz cumpleaños, ${firstName(g.name)}! 🎂 De parte de todo el equipo de ${restaurantName}. Si quieres celebrarlo con nosotros esta semana, la copa de vino va por nuestra cuenta — solo menciona este mensaje al llegar.`;
  }
  return `¡Hola ${firstName(g.name)}! Te escribimos de ${restaurantName}.`;
}

function waUrl(g: GuestRow, todayMmdd: string, restaurantName: string): string {
  const phone = g.whatsapp.replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(messageFor(g, todayMmdd, restaurantName))}`;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+52 ${digits.slice(2, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `hace ${days}d`;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// ── Styles ───────────────────────────────────────────────────────────────────

const GUESTS_CSS = `
/* ───────────────────────────────────────────────────────────────
   Club VIP — Editorial Brutalist surface
   Aligned with globals.css :root tokens and LiveView.tsx
   ─────────────────────────────────────────────────────────────── */

/* ── Hero metrics banner — mirrors .impact-wrapper pattern ────── */
.hero-banner {
  background: var(--text-main);
  color: #fff;
  padding: 2.75rem 2.5rem 2.25rem;
  position: relative;
  border-bottom: 1px solid var(--text-main);
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.05s;
}
.hero-live {
  position: absolute;
  top: 1rem;
  right: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}
.hero-live-dot {
  width: 7px;
  height: 7px;
  background: var(--green);
  animation: hero-pulse 2.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes hero-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.45; transform: scale(0.7); }
}
.hero-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: stretch;
}
.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  text-align: center;
  padding: 0 1rem;
  border-right: 1px solid rgba(255,255,255,0.1);
}
.hero-stat:last-child { border-right: none; }
.hero-stat-value {
  font-family: var(--font-serif);
  font-size: 5.5rem;
  font-weight: 600;
  color: #fff;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  transition: color 0.4s ease;
  display: block;
}
.hero-stat-highlight {
  color: var(--green) !important;
  animation: stat-flash 2.5s ease-out forwards;
}
@keyframes stat-flash {
  0%   { color: var(--green); }
  60%  { color: var(--green); }
  100% { color: #fff; }
}
.hero-stat-label {
  margin-top: 0.7rem;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}
.hero-split {
  margin-top: 1.75rem;
  padding-top: 1.25rem;
  border-top: 1px solid rgba(255,255,255,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: rgba(255,255,255,0.7);
  font-variant-numeric: tabular-nums;
}
.hero-split strong { color: #fff; font-weight: 600; }
.hero-dot { color: rgba(255,255,255,0.25); }

/* ── Leaderboard strip ─ flat-panel with ledger-row dividers ──── */
.leaderboard-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--text-main);
  padding: 0.85rem 2.5rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.1s;
}
.leaderboard-heading {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--gold);
  white-space: nowrap;
}
.leaderboard-entries {
  display: flex;
  gap: 0;
  flex-wrap: wrap;
  flex: 1 1 auto;
}
.leaderboard-entry {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.82rem;
  padding: 0 1.25rem;
  border-right: 1px solid var(--panel-border);
}
.leaderboard-entry:last-child { border-right: none; }
.leaderboard-entry:first-child { padding-left: 0; }
.leaderboard-rank {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dim);
  width: 0.9rem;
  text-align: center;
}
.leaderboard-name {
  font-weight: 600;
  color: var(--text-main);
}
.leaderboard-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  color: var(--text-main);
  background: var(--bg-base);
  border: 1px solid var(--text-main);
  padding: 1px 7px;
  font-weight: 700;
}

/* ── Page shell ────────────────────────────────────────────────── */
.guests-root { padding: 0; }
.guests-header {
  padding: 0 2.5rem;
  margin-bottom: 1.25rem;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.15s;
}
.guests-header-inner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.guests-title {
  font-family: var(--font-serif);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 0;
  letter-spacing: -0.02em;
}
.guests-subtitle {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0.25rem 0 0;
}
.guests-subtitle a { color: var(--text-main); text-decoration: underline; text-decoration-color: var(--text-dim); text-underline-offset: 3px; }
.guests-subtitle a:hover { text-decoration-color: var(--text-main); }
.guests-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.guests-brand-select {
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--panel-border);
  background: var(--bg-base);
  color: var(--text-dim);
  font-size: 0.72rem;
  font-family: inherit;
  cursor: not-allowed;
  max-width: 100%;
  border-radius: 0;
}
.guests-export-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.55rem 0.95rem;
  border: 1px solid var(--text-main);
  background: var(--panel-bg);
  color: var(--text-main);
  font-size: 0.72rem;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.guests-export-btn:hover { background: var(--text-main); color: var(--panel-bg); }
.guests-export-btn--solid {
  background: var(--text-main);
  color: var(--panel-bg);
}
.guests-export-btn--solid:hover { background: #333; color: var(--panel-bg); }

/* ── Filter bar ────────────────────────────────────────────────── */
.guests-filterbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 2.5rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.2s;
}
.guests-filters {
  display: flex;
  gap: 0;
  flex-wrap: wrap;
  flex: 1 1 auto;
  min-width: 0;
}
.guests-filter-btn {
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
}
.guests-filter-btn:last-child { border-right-width: 1px; }
.guests-filter-btn:hover { background: var(--bg-base); }
.guests-filter-btn.active {
  background: var(--text-main);
  color: var(--panel-bg);
}
.guests-search {
  margin-left: auto;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--text-main);
  font-size: 0.85rem;
  font-family: inherit;
  width: 240px;
  background: var(--panel-bg);
  outline: none;
  border-radius: 0;
}
.guests-search:focus { box-shadow: var(--shadow-md); }

/* ── Table ─────────────────────────────────────────────────────── */
.guests-table-wrap {
  border: 1px solid var(--text-main);
  background: var(--panel-bg);
  overflow: auto;
  margin: 0 2.5rem;
  animation: fadeInUp 0.4s ease both;
  animation-delay: 0.25s;
}
.guests-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.guests-table thead tr {
  background: var(--bg-base);
  border-bottom: 1px solid var(--text-main);
}
.guests-row {
  border-bottom: 1px solid var(--panel-border);
  cursor: pointer;
  background: var(--panel-bg);
  transition: background 0.12s;
}
.guests-row:last-child { border-bottom: none; }
.guests-row:hover { background: var(--bg-base); }
.guests-cards { display: none; list-style: none; padding: 0; margin: 0; }

/* ── WhatsApp send button ────────────────────────────────────────── */
.guests-wa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  background: #25D366;
  color: #fff;
  border: 1px solid #25D366;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
  border-radius: 0;
  transition: all 0.15s ease;
}
.guests-wa-btn:hover { background: #1fb858; border-color: #1fb858; }
.guests-wa-btn--sent {
  background: var(--bg-base);
  color: var(--text-muted);
  border-color: var(--panel-border);
}
.guests-wa-btn--sent:hover { background: var(--bg-base); border-color: var(--panel-border); }
.guests-wa-btn--block { width: 100%; padding: 0.6rem; box-sizing: border-box; }

/* ── Drawer ────────────────────────────────────────────────────── */
.guests-drawer {
  width: 100%;
  max-width: 440px;
  background: var(--panel-bg);
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid var(--text-main);
  padding: 1.75rem 1.5rem;
  box-sizing: border-box;
  animation: fadeIn 0.2s ease;
}

/* ── Large desktop / TV projection ─────────────────────────────── */
@media (min-width: 1440px) {
  .hero-stat-value  { font-size: 7rem; }
  .hero-stat-label  { font-size: 0.72rem; letter-spacing: 0.22em; }
  .hero-split       { font-size: 0.9rem; margin-top: 2rem; padding-top: 1.5rem; }
  .hero-banner      { padding: 3.5rem 3rem 2.75rem; }
  .leaderboard-bar  { padding: 0.95rem 3rem; }
  .leaderboard-name { font-size: 0.95rem; }
  .guests-header,
  .guests-filterbar { padding-left: 3rem; padding-right: 3rem; }
  .guests-table-wrap { margin: 0 3rem; }
}

/* ── iPad / tablet (≤1024px) ───────────────────────────────────── */
@media (max-width: 1024px) {
  .hero-stat-value { font-size: 3.75rem; }
  .hero-banner { padding: 2rem 1.5rem 1.75rem; }
  .leaderboard-bar { padding: 0.75rem 1.5rem; }
  .guests-table { font-size: 0.8rem; }
  .guests-table th, .guests-table td { padding: 0.55rem 0.7rem !important; }
  .guests-search { width: 200px; font-size: 16px; }
  .guests-table-wrap { margin: 0 1.5rem; }
  .guests-filterbar { padding: 0 1.5rem; }
  .guests-header { padding: 0 1.5rem; }
  .guests-title { font-size: 1.5rem; }
}

/* ── Phone (≤640px) ────────────────────────────────────────────── */
@media (max-width: 640px) {
  .hero-banner { padding: 1.75rem 1rem 1.5rem; }
  .hero-stats { grid-template-columns: repeat(2, 1fr); }
  .hero-stat {
    padding: 0.85rem 0.5rem;
    border-right: 1px solid rgba(255,255,255,0.1);
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .hero-stat:nth-child(2) { border-right: none; }
  .hero-stat:nth-child(3),
  .hero-stat:nth-child(4) { border-bottom: none; }
  .hero-stat-value { font-size: 2.75rem; }
  .hero-stat-label { font-size: 0.58rem; letter-spacing: 0.14em; margin-top: 0.45rem; }
  .hero-split  { font-size: 0.72rem; gap: 0.5rem; margin-top: 1.25rem; padding-top: 1rem; }
  .hero-live   { font-size: 0.55rem; top: 0.75rem; right: 1rem; }
  .leaderboard-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 0;
    margin-bottom: 1rem;
  }
  .leaderboard-heading {
    padding: 0.6rem 1rem 0.55rem;
    border-bottom: 1px solid var(--panel-border);
  }
  .leaderboard-entries {
    flex-direction: column;
    gap: 0;
    width: 100%;
  }
  .leaderboard-entry {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    border-right: none;
    border-bottom: 1px solid var(--panel-border);
    gap: 0.85rem;
  }
  .leaderboard-entry:last-child { border-bottom: none; }
  .leaderboard-entry:first-child { padding-left: 1rem; }
  .leaderboard-rank {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--gold);
    width: 1.5rem;
    text-align: left;
    line-height: 1;
    flex-shrink: 0;
  }
  .leaderboard-name {
    flex: 1 1 auto;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-left: -0.15rem;
  }
  .leaderboard-count {
    font-size: 0.85rem;
    padding: 2px 10px;
    flex-shrink: 0;
  }

  .guests-header { padding: 0 1rem; }
  .guests-title { font-size: 1.3rem; }
  .guests-subtitle { font-size: 0.75rem; }
  .guests-header-inner { flex-direction: column; align-items: stretch; gap: 0.7rem; }
  .guests-actions { justify-content: flex-start; }
  .guests-brand-select { flex: 1 1 auto; min-width: 0; font-size: 0.7rem; }
  .guests-export-btn { font-size: 0.68rem; padding: 0.55rem 0.75rem; }
  .guests-filterbar { padding: 0 1rem; gap: 0.6rem; flex-direction: column; align-items: stretch; }
  .guests-filters { width: 100%; }
  .guests-filter-btn { flex: 1 1 calc(50% - 0.2rem); font-size: 0.66rem; padding: 0.55rem 0.5rem; border-right-width: 1px; border-bottom-width: 0; }
  .guests-filter-btn:last-child { border-bottom-width: 1px; }
  .guests-search { margin-left: 0; width: 100%; font-size: 16px; padding: 0.7rem 0.75rem; }

  .guests-table-wrap { display: none; }
  .guests-cards {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0 1rem;
  }
  .guests-card {
    background: var(--panel-bg);
    border: 1px solid var(--text-main);
    padding: 0.95rem 1rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    transition: box-shadow 0.15s ease;
  }
  .guests-card:active { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .guests-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .guests-card-name {
    font-weight: 600;
    color: var(--text-main);
    font-size: 0.95rem;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .guests-card-phone {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .guests-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    font-size: 0.74rem;
    color: var(--text-muted);
  }
  .guests-card-meta strong { color: var(--text-main); font-weight: 600; }
  .guests-card-prefs {
    font-size: 0.72rem;
    color: var(--text-muted);
    border-top: 1px solid var(--panel-border);
    padding-top: 0.45rem;
  }

  .guests-drawer { max-width: 100%; padding: 1.25rem; }
}
`;

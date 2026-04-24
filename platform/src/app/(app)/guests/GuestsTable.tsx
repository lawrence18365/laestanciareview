'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

type Filter = 'all' | 'birthdays' | 'absent60' | 'vip';

const FILTER_LABELS: Record<Filter, string> = {
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
}: {
  guests: GuestRow[];
  restaurantName: string;
  brand: string;
  slug: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GuestRow | null>(null);

  const filtered = useMemo(() => {
    const now = new Date();
    const thisMonth = String(now.getMonth() + 1).padStart(2, '0');
    const cutoff60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const q = search.trim().toLowerCase();

    return guests.filter((g) => {
      if (filter === 'birthdays') {
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
  }, [guests, filter, search]);

  const captureUrl = `/g/${slug}`;

  return (
    <div style={{ padding: '1.25rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1c1917', margin: 0, letterSpacing: '-0.02em' }}>
              Invitados
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#78716c', margin: '0.25rem 0 0' }}>
              {restaurantName} · {guests.length} capturados · <a href={captureUrl} target="_blank" rel="noreferrer" style={{ color: '#1c1917' }}>Ver página pública →</a>
            </p>
          </div>

          {/* Disabled multi-brand selector — teases the enterprise tier. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              disabled
              title="Disponible en el plan Multi-marca (Enterprise)"
              style={{
                padding: '0.4rem 0.6rem',
                border: '1.5px solid #d6d3d1',
                background: '#f5f4f2',
                color: '#a8a29e',
                fontSize: '0.75rem',
                cursor: 'not-allowed',
              }}
            >
              <option>{brand ? brand.toUpperCase() : 'Una marca'} — Próximamente multi-marca</option>
            </select>
            {/* File download — plain <a> triggers the browser's download flow. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/v1/guests/export"
              style={{
                padding: '0.5rem 0.85rem',
                border: '1px solid #111',
                background: '#fff',
                color: '#111',
                fontSize: '0.72rem',
                fontWeight: 700,
                textDecoration: 'none',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Exportar CSV
            </a>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(['all', 'birthdays', 'absent60', 'vip'] as Filter[]).map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: `1.5px solid ${active ? '#111' : '#d6d3d1'}`,
                background: active ? '#111' : '#fff',
                color: active ? '#fff' : '#1c1917',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {FILTER_LABELS[f]}
            </button>
          );
        })}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nombre o WhatsApp…"
          style={{
            marginLeft: 'auto',
            padding: '0.45rem 0.65rem',
            border: '1.5px solid #d6d3d1',
            fontSize: '0.82rem',
            width: 220,
            background: '#fff',
            outline: 'none',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState captureUrl={captureUrl} guestsTotal={guests.length} />
      ) : (
        <div style={{ border: '1px solid #e7e5e4', background: '#fff', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#faf8f6', borderBottom: '1px solid #e7e5e4' }}>
                <Th>Nombre</Th>
                <Th>WhatsApp</Th>
                <Th>Cumple</Th>
                <Th>Preferencias</Th>
                <Th>Visitas</Th>
                <Th>Última visita</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => setSelected(g)}
                  style={{
                    borderBottom: '1px solid #f5f4f2',
                    cursor: 'pointer',
                    background: '#fff',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#faf8f6')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                >
                  <Td>
                    <div style={{ fontWeight: 600, color: '#1c1917' }}>{g.name}</div>
                    {g.visitCount >= 5 && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 2,
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          background: '#fef3c7',
                          color: '#92400e',
                          padding: '1px 5px',
                        }}
                      >
                        VIP
                      </span>
                    )}
                  </Td>
                  <Td style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.78rem' }}>
                    {formatPhone(g.whatsapp)}
                  </Td>
                  <Td>{g.birthdayMmdd ?? '—'}</Td>
                  <Td>
                    {g.preferences && g.preferences.length > 0 ? (
                      <span style={{ color: '#57534e', fontSize: '0.75rem' }}>{g.preferences.join(', ')}</span>
                    ) : (
                      <span style={{ color: '#a8a29e' }}>—</span>
                    )}
                  </Td>
                  <Td>{g.visitCount}</Td>
                  <Td>{g.lastVisit ? formatRelative(g.lastVisit) : '—'}</Td>
                  <Td>
                    <StatusBadge status={g.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <GuestDrawer
          guest={selected}
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.65rem 0.85rem',
        fontSize: '0.62rem',
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#78716c',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '0.7rem 0.85rem', color: '#1c1917', ...style }}>
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: GuestRow['status'] }) {
  const styles: Record<GuestRow['status'], React.CSSProperties> = {
    pending_validation: { background: '#fef3c7', color: '#92400e' },
    validated: { background: '#d1fae5', color: '#065f46' },
    expired: { background: '#f5f4f2', color: '#78716c' },
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
        fontSize: '0.58rem',
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

function EmptyState({ captureUrl, guestsTotal }: { captureUrl: string; guestsTotal: number }) {
  return (
    <div
      style={{
        border: '1px dashed #d6d3d1',
        background: '#fff',
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        color: '#78716c',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.9rem' }}>
        {guestsTotal === 0
          ? 'Aún no has capturado invitados.'
          : 'Ningún invitado coincide con este filtro.'}
      </p>
      {guestsTotal === 0 && (
        <a
          href={captureUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            marginTop: '0.75rem',
            padding: '0.55rem 1rem',
            border: '1px solid #111',
            color: '#111',
            textDecoration: 'none',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Abrir página de captura
        </a>
      )}
    </div>
  );
}

function GuestDrawer({
  guest,
  onClose,
  onSaved,
}: {
  guest: GuestRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(guest.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [visiting, setVisiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/guests/${guest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        setError('No se pudo guardar');
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

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 100,
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          height: '100%',
          overflowY: 'auto',
          borderLeft: '1px solid #1c1917',
          padding: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#1c1917', letterSpacing: '-0.02em' }}>
              {guest.name}
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: '#78716c', fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {formatPhone(guest.whatsapp)}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: '#78716c',
              padding: '0 0.25rem',
            }}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <dl style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: '#1c1917' }}>
          <DlRow label="Cumpleaños" value={guest.birthdayMmdd ?? '—'} />
          <DlRow label="Preferencias" value={guest.preferences?.join(', ') || '—'} />
          <DlRow label="Visitas" value={String(guest.visitCount)} />
          <DlRow label="Primera captura" value={formatDate(guest.capturedAt)} />
          <DlRow label="Última visita" value={guest.lastVisit ? formatDate(guest.lastVisit) : '—'} />
          <DlRow label="Estado" value={<StatusBadge status={guest.status} />} />
          {guest.status === 'pending_validation' && guest.validationCode && (
            <DlRow label="Código" value={<code style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.95rem', fontWeight: 700 }}>{guest.validationCode}</code>} />
          )}
          {guest.redemptionType && <DlRow label="Entrega" value={guest.redemptionType.replace('_', ' ')} />}
          {guest.marketingConsent && <DlRow label="Consentimiento WhatsApp" value="Sí" />}
        </dl>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#57534e', display: 'block', marginBottom: '0.35rem' }}>
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
              padding: '0.6rem',
              border: '1.5px solid #d6d3d1',
              fontSize: '0.82rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '0.5rem 0.7rem',
              fontSize: '0.78rem',
              marginBottom: '0.75rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              flex: 1,
              padding: '0.8rem',
              background: saving ? '#78716c' : '#111',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.76rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Guardando…' : 'Guardar notas'}
          </button>
          <button
            onClick={logVisit}
            disabled={visiting}
            style={{
              flex: 1,
              padding: '0.8rem',
              background: '#fff',
              color: '#111',
              border: '1.5px solid #111',
              fontWeight: 700,
              fontSize: '0.76rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: visiting ? 'wait' : 'pointer',
            }}
          >
            {visiting ? 'Registrando…' : '+ Visita'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function DlRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0.35rem 0', borderBottom: '1px solid #f5f4f2' }}>
      <dt style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#78716c' }}>
        {label}
      </dt>
      <dd style={{ margin: 0, textAlign: 'right', maxWidth: '60%' }}>{value}</dd>
    </div>
  );
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
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
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

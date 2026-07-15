'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';

interface VipGuest {
  id: number;
  name: string;
  whatsapp: string;
  birthdayMmdd: string | null;
  preferences: string[];
  marketingConsent: boolean;
  redemptionType: string | null;
  promoType: string | null;
  visitCount: number;
  lastVisit: string | null;
}

interface Props {
  guests: VipGuest[];
  currentMonthMm: string;
}

const MESSAGE = `🍷 *CENA MARIDAJE · SANTO TOMÁS* 🍷
La Estancia Argentina León

Una noche en Valle de Santo Tomás, sin salir de León.

4 vinos de *Bodegas Santo Tomás* — la bodega más antigua de México — maridados en 4 tiempos por nuestro chef, con *cata dirigida por su embajadora.*

🗓 Jueves 30 de julio · 8:00 PM
🍽 4 tiempos · 4 vinos
💵 $1,599 por persona
📍 Cupo limitado

Reserva con anticipo para apartar tu lugar. Escríbenos por aquí y con gusto te atendemos. 🥂`;

const STORAGE_KEY = 'vip-vino-contacted-v1';

// localStorage-backed store via useSyncExternalStore: hydrates with the empty
// server snapshot, then re-renders with the device's real contacted list.
const storeListeners = new Set<() => void>();

function readContactedRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

function writeContacted(ids: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked/full — the UI simply won't persist across reloads
  }
  storeListeners.forEach((l) => l());
}

function subscribeContacted(cb: () => void) {
  storeListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    storeListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Tier = 'copa' | 'vino' | 'resto';

function tierOf(g: VipGuest): Tier {
  if (g.redemptionType === 'copa_vino') return 'copa';
  const promo = g.promoType?.toLowerCase();
  if (g.preferences.includes('Vino') || promo === 'wine' || promo === 'copa') return 'vino';
  return 'resto';
}

function redemptionLabel(type: string | null): string | null {
  if (type === 'copa_vino') return 'Copa de vino';
  if (type === 'postre') return 'Postre';
  if (type === 'otro') return 'Otra cortesía';
  return null;
}

// Deterministic formatter — Intl output differs between server and browser,
// which would break hydration.
function formatDate(iso: string | null): string {
  if (!iso) return 'Sin visita registrada';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatPhone(wa: string): string {
  // 52 477 123 4567
  if (wa.length === 12 && wa.startsWith('52')) {
    return `+52 ${wa.slice(2, 5)} ${wa.slice(5, 8)} ${wa.slice(8)}`;
  }
  return `+${wa}`;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

// Copa de Vino (hottest tier) gets a personal greeting; birthday-of-the-month
// guests get a birthday intro instead (it wins over the copa greeting and
// already carries the name). Everyone else receives MESSAGE exactly as written.
function messageFor(g: VipGuest, currentMonthMm: string): string {
  if (g.birthdayMmdd?.slice(3) === currentMonthMm) {
    return `¡Hola ${firstName(g.name)}! Vi que cumples este mes 🎂 y pensé que esto podría ser una forma bonita de celebrarlo:\n\n${MESSAGE}`;
  }
  if (tierOf(g) === 'copa') {
    return `¡Hola ${firstName(g.name)}! 🍷\n\n${MESSAGE}`;
  }
  return MESSAGE;
}

function waUrl(g: VipGuest, currentMonthMm: string): string {
  return `https://wa.me/${g.whatsapp}?text=${encodeURIComponent(messageFor(g, currentMonthMm))}`;
}

const WhatsAppIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
);

export default function VipList({ guests, currentMonthMm }: Props) {
  const [query, setQuery] = useState('');
  const [hideContacted, setHideContacted] = useState(false);

  const contactedRaw = useSyncExternalStore(subscribeContacted, readContactedRaw, () => '[]');
  const contacted = useMemo(() => {
    try {
      return new Set(JSON.parse(contactedRaw) as number[]);
    } catch {
      return new Set<number>();
    }
  }, [contactedRaw]);

  const markContacted = (id: number) => {
    const next = new Set(contacted);
    next.add(id);
    writeContacted(Array.from(next));
  };

  const toggleContacted = (id: number) => {
    const next = new Set(contacted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeContacted(Array.from(next));
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const matches = (g: VipGuest) =>
      !q || g.name.toLowerCase().includes(q) || (digits.length > 0 && g.whatsapp.includes(digits));

    const sortGroup = (arr: VipGuest[]) =>
      [...arr].sort((a, b) => {
        if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
        const av = a.lastVisit ?? '';
        const bv = b.lastVisit ?? '';
        if (av !== bv) return bv.localeCompare(av);
        return a.name.localeCompare(b.name, 'es');
      });

    const visible = guests.filter(matches).filter((g) => !hideContacted || !contacted.has(g.id));
    return {
      copa: sortGroup(visible.filter((g) => tierOf(g) === 'copa')),
      vino: sortGroup(visible.filter((g) => tierOf(g) === 'vino')),
      resto: sortGroup(visible.filter((g) => tierOf(g) === 'resto')),
    };
  }, [guests, query, hideContacted, contacted]);

  const contactedCount = guests.filter((g) => contacted.has(g.id)).length;

  const renderCard = (g: VipGuest, index: number) => {
    const isContacted = contacted.has(g.id);
    const isVip = g.visitCount >= 5;
    const isBirthdayMonth = g.birthdayMmdd?.slice(3) === currentMonthMm;
    const cortesia = redemptionLabel(g.redemptionType);
    const tier = tierOf(g);

    return (
      <div
        key={g.id}
        style={{
          background: '#1E293B',
          borderRadius: '12px',
          padding: '16px',
          border:
            tier === 'copa'
              ? '1px solid rgba(168,85,247,0.35)'
              : tier === 'vino'
                ? '1px solid rgba(251,191,36,0.25)'
                : '1px solid rgba(255,255,255,0.06)',
          opacity: isContacted ? 0.45 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 600 }}>
                {index + 1}. {g.name}
              </span>
              {isVip && (
                <span style={{ background: 'rgba(251,191,36,0.15)', color: '#FBBF24', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', border: '1px solid rgba(251,191,36,0.35)' }}>
                  ⭐ VIP · {g.visitCount} visitas
                </span>
              )}
              {isBirthdayMonth && (
                <span style={{ background: 'rgba(236,72,153,0.15)', color: '#F472B6', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', border: '1px solid rgba(236,72,153,0.35)' }}>
                  🎂 Cumple este mes
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
              {cortesia ? (
                <span style={{ color: tier === 'copa' ? '#C084FC' : '#94A3B8', fontSize: '13px', fontWeight: 700 }}>
                  🍷 Cortesía: {cortesia}
                </span>
              ) : g.preferences.length > 0 ? (
                <span style={{ color: '#FBBF24', fontSize: '13px', fontWeight: 600 }}>
                  Prefiere: {g.preferences.join(' · ')}
                </span>
              ) : (
                <span style={{ color: '#64748B', fontSize: '13px' }}>Sin preferencias registradas</span>
              )}
            </div>

            <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>
              {formatPhone(g.whatsapp)} · Última visita: {formatDate(g.lastVisit)}
              {!isVip && g.visitCount > 0 && ` · ${g.visitCount} ${g.visitCount === 1 ? 'visita' : 'visitas'}`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <a
            href={waUrl(g, currentMonthMm)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markContacted(g.id)}
            style={{
              flex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              background: isContacted ? '#334155' : '#25D366',
              color: '#fff',
              padding: '12px', borderRadius: '8px',
              fontSize: '15px', fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            {WhatsAppIcon}
            {isContacted ? 'Enviado ✓' : 'WhatsApp'}
          </a>
          <button
            onClick={() => toggleContacted(g.id)}
            style={{
              background: 'rgba(255,255,255,0.08)', color: '#94A3B8',
              padding: '12px 14px', borderRadius: '8px',
              fontSize: '13px', fontWeight: 600,
              border: 'none', cursor: 'pointer',
            }}
          >
            {isContacted ? 'Deshacer' : 'Marcar ✓'}
          </button>
        </div>
      </div>
    );
  };

  const renderSection = (emoji: string, title: string, subtitle: string, list: VipGuest[]) => (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '20px' }}>{emoji}</span>
        <span style={{ color: '#F8FAFC', fontSize: '16px', fontWeight: 700 }}>
          {title} ({list.length})
        </span>
        <span style={{ color: '#64748B', fontSize: '13px' }}>— {subtitle}</span>
      </div>
      {list.length === 0 ? (
        <div style={{ color: '#475569', fontSize: '13px', padding: '8px 4px' }}>Nadie en esta sección.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {list.map((g, i) => renderCard(g, i))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '32px 16px 20px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '13px', color: '#C084FC', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' as const, marginBottom: '8px' }}>
          Club VIP · Estancia León
        </div>
        <h1 style={{ color: '#F8FAFC', fontSize: '24px', fontWeight: 700, margin: '0 0 4px' }}>
          🍷 Cena Maridaje Santo Tomás
        </h1>
        <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>
          Toca WhatsApp → se abre el mensaje → manda. Solo invitados con consentimiento.
        </p>
        <div style={{ color: '#94A3B8', fontSize: '13px', marginTop: '10px', fontWeight: 600 }}>
          {contactedCount} de {guests.length} contactados
        </div>
        {/* Progress bar */}
        <div style={{ maxWidth: '320px', margin: '8px auto 0', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{
            width: guests.length > 0 ? `${Math.round((contactedCount / guests.length) * 100)}%` : '0%',
            height: '100%', background: '#25D366', borderRadius: '999px', transition: 'width 0.3s',
          }} />
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o teléfono…"
            style={{
              flex: 1,
              background: '#1E293B', color: '#F8FAFC',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
              padding: '10px 14px', fontSize: '14px', outline: 'none',
            }}
          />
          <button
            onClick={() => setHideContacted((v) => !v)}
            style={{
              background: hideContacted ? 'rgba(37,211,102,0.15)' : 'rgba(255,255,255,0.08)',
              color: hideContacted ? '#25D366' : '#94A3B8',
              border: hideContacted ? '1px solid rgba(37,211,102,0.4)' : '1px solid transparent',
              borderRadius: '8px', padding: '10px 12px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const,
            }}
          >
            {hideContacted ? 'Mostrando pendientes' : 'Ocultar enviados'}
          </button>
        </div>

        {renderSection('🍷', 'Copa de Vino', 'ya recibieron la cortesía — máxima prioridad', groups.copa)}
        {renderSection('🥂', 'Prefieren vino', 'declararon vino, sin cortesía reclamada', groups.vino)}
        {renderSection('📋', 'Resto del Club VIP', 'toda la base de León', groups.resto)}

        {/* Tips */}
        <div style={{
          background: 'rgba(192,132,252,0.08)',
          border: '1px solid rgba(192,132,252,0.2)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '32px',
        }}>
          <div style={{ color: '#C084FC', fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
            Tips para el blitz
          </div>
          <ul style={{ color: '#CBD5E1', fontSize: '13px', lineHeight: 1.6, margin: 0, paddingLeft: '16px' }}>
            <li>El mensaje ya viene llenado — solo dale send</li>
            <li>🍷 Copa de Vino y 🎂 cumpleañeros llevan saludo personalizado con su nombre — los demás reciben el mensaje exacto</li>
            <li>Empieza por la sección 🍷 Copa de Vino: ya probaron el vino, es el cierre más fácil</li>
            <li>Al tocar WhatsApp la tarjeta se marca sola como enviada (se guarda en este teléfono)</li>
            <li>⭐ VIP y 🎂 cumple este mes = trato personal, agrega una línea a mano si puedes</li>
            <li>Si responden con interés: pide el anticipo para apartar el lugar ese mismo chat</li>
          </ul>
        </div>

        <div style={{ textAlign: 'center', padding: '0 0 32px', color: '#475569', fontSize: '12px' }}>
          Jueves 30 de julio · 8:00 PM · $1,599 por persona · Cupo limitado
        </div>
      </div>
    </div>
  );
}

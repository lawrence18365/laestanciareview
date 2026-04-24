'use client';

import { useState } from 'react';

interface StaffMember {
  id: number;
  code: string;
  name: string;
}

const REDEMPTIONS: Array<{ key: 'copa_vino' | 'postre' | 'otro'; label: string }> = [
  { key: 'copa_vino', label: 'Copa de vino' },
  { key: 'postre', label: 'Postre' },
  { key: 'otro', label: 'Otro' },
];

interface SuccessResult {
  guestName: string;
  guestWhatsapp: string;
  redemptionType: string;
}

export default function ValidateForm({
  slug,
  restaurantName,
  brandLogo,
  brandDarkBg,
  staffList,
}: {
  slug: string;
  restaurantName: string;
  brandLogo: string;
  brandDarkBg: boolean;
  staffList: StaffMember[];
}) {
  const [code, setCode] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [redemption, setRedemption] = useState<'copa_vino' | 'postre' | 'otro'>('copa_vino');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessResult | null>(null);

  const reset = () => {
    setCode('');
    setStaffCode('');
    setRedemption('copa_vino');
    setNotes('');
    setError(null);
    setSuccess(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(code)) {
      setError('El código debe tener 4 dígitos.');
      return;
    }
    if (!staffCode) {
      setError('Selecciona tu nombre.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/guests/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantSlug: slug,
          code,
          staffCode,
          redemptionType: redemption,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.status === 404) {
        setError('Código no encontrado. Verifica con el invitado.');
        return;
      }
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'Este código ya fue usado.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? 'No pudimos validar el código.');
        return;
      }
      const data = (await res.json()) as { guestName: string; guestWhatsapp: string; redemptionType: string };
      setSuccess(data);
    } catch {
      setError('Sin conexión. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '2rem 1rem 3rem',
        background: '#FAFAF9',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: '#D97706', zIndex: 10 }} />

      <div
        style={{
          width: 96,
          height: 96,
          background: brandDarkBg ? '#111' : '#fff',
          border: '2px solid #111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0.5rem 0 1rem',
          boxShadow: '4px 4px 0 rgba(0,0,0,0.06)',
        }}
      >
        <img src={brandLogo} alt={restaurantName} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }} />
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          border: '1px solid #1c1917',
          padding: '1.75rem 1.5rem',
          boxShadow: '6px 6px 0 rgba(0,0,0,0.06)',
        }}
      >
        {success ? (
          <>
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.5rem' }}>✅</div>
            <h1 style={h1Style}>¡Código validado!</h1>
            <p style={{ color: '#57534e', textAlign: 'center', margin: '0 0 1rem', fontSize: '0.9rem' }}>
              Entrega: <strong>{labelForRedemption(success.redemptionType)}</strong>
            </p>
            <div
              style={{
                background: '#faf8f6',
                border: '1px solid #e7e5e4',
                padding: '1rem',
                marginBottom: '1.25rem',
                fontSize: '0.88rem',
                color: '#1c1917',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{success.guestName}</div>
              <div style={{ color: '#78716c', fontSize: '0.78rem', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {success.guestWhatsapp}
              </div>
            </div>
            <button
              onClick={reset}
              style={{
                width: '100%',
                padding: '0.9rem',
                background: '#111',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.8rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Validar otro
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 style={h1Style}>Validar invitado</h1>
            <p style={{ color: '#78716c', textAlign: 'center', margin: '0 0 1.25rem', fontSize: '0.85rem' }}>
              {restaurantName}
            </p>

            <Label>Código del invitado</Label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              pattern="[0-9]*"
              required
              placeholder="••••"
              autoFocus
              style={{
                ...inputStyle,
                fontSize: '1.8rem',
                letterSpacing: '0.6rem',
                textAlign: 'center',
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontWeight: 700,
              }}
            />

            <Label>Tu nombre</Label>
            <select
              value={staffCode}
              onChange={(e) => setStaffCode(e.target.value)}
              required
              style={{ ...inputStyle, background: '#fff' }}
            >
              <option value="">Selecciona…</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>

            <Label>Qué entregas</Label>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
              {REDEMPTIONS.map((r) => {
                const active = redemption === r.key;
                return (
                  <button
                    type="button"
                    key={r.key}
                    onClick={() => setRedemption(r.key)}
                    style={{
                      flex: 1,
                      padding: '0.6rem 0.4rem',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      border: `1.5px solid ${active ? '#111' : '#d6d3d1'}`,
                      background: active ? '#111' : '#fff',
                      color: active ? '#fff' : '#1c1917',
                      cursor: 'pointer',
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <Label>Notas <span style={{ fontWeight: 400, color: '#a8a29e' }}>(opcional)</span></Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="ej. Mesa 12"
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: 60 }}
            />

            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.8rem',
                  marginBottom: '0.75rem',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '0.95rem',
                background: submitting ? '#78716c' : '#111',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.85rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? 'Validando…' : 'Confirmar entrega'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function labelForRedemption(key: string): string {
  return REDEMPTIONS.find((r) => r.key === key)?.label ?? key;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: '0.68rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#57534e',
        marginBottom: '0.35rem',
      }}
    >
      {children}
    </label>
  );
}

const h1Style: React.CSSProperties = {
  fontSize: '1.3rem',
  fontWeight: 800,
  color: '#1c1917',
  letterSpacing: '-0.02em',
  margin: '0 0 0.25rem',
  textAlign: 'center',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.75rem',
  border: '1.5px solid #d6d3d1',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  marginBottom: '1rem',
  background: '#fff',
  color: '#1c1917',
  outline: 'none',
  boxSizing: 'border-box',
};

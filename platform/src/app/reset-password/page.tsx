'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: '0.4rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.65rem 0.75rem',
  border: '1px solid var(--border-dark)',
  borderRadius: 0,
  fontSize: '0.9rem',
  fontFamily: 'var(--font-sans)',
  background: 'var(--panel-bg)',
  color: 'var(--text-main)',
};

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '1.25rem',
          border: '1px solid var(--red)',
          background: 'var(--red-light)',
          color: 'var(--red)',
          fontSize: '0.8rem',
          fontWeight: 500,
        }}>
          Enlace invalido. Solicita un nuevo enlace desde la pagina de inicio de sesion.
        </div>
        <a href="/login" style={{
          color: 'var(--text-dim)',
          fontSize: '0.65rem',
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Volver al Inicio de Sesion
        </a>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Algo salio mal');
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch {
      setError('Algo salio mal. Por favor intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48,
          height: 48,
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--green)',
          color: 'var(--green)',
          fontSize: '1.5rem',
        }}>
          &#10003;
        </div>
        <h2 className="editorial-serif" style={{
          fontSize: '1.25rem',
          fontWeight: 600,
          marginBottom: '0.5rem',
          color: 'var(--text-main)',
        }}>
          Contraseña Actualizada
        </h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          Redirigiendo al inicio de sesion...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="password" style={labelStyle}>
          Nueva Contraseña
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Minimo 8 caracteres"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="confirm" style={labelStyle}>
          Confirmar Contraseña
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="Repite la nueva contraseña"
          style={inputStyle}
        />
      </div>

      {error && (
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '1rem',
          border: '1px solid var(--red)',
          background: 'var(--red-light)',
          color: 'var(--red)',
          fontSize: '0.8rem',
          fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '0.75rem',
          border: 'none',
          borderRadius: 0,
          background: 'var(--text-main)',
          color: 'var(--panel-bg)',
          fontWeight: 700,
          fontSize: '0.7rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          transition: 'all 0.15s ease',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {loading ? 'Actualizando...' : 'Restablecer Contraseña'}
      </button>

      <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
        <a href="/login" style={{
          color: 'var(--text-dim)',
          fontSize: '0.65rem',
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Volver al Inicio de Sesion
        </a>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
      padding: '1rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-dark)',
        padding: '2.5rem 2rem',
        boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logos/ratetap_logo_transparent_background.png"
            alt="RateTap"
            style={{ height: 120, margin: '0 auto 1rem', objectFit: 'contain', display: 'block' }}
          />
          <div style={{
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}>
            Restablecer Contraseña
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--panel-border)', marginBottom: '1.5rem' }} />

        <Suspense fallback={
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>Cargando...</p>
        }>
          <ResetPasswordForm />
        </Suspense>

        {/* Footer */}
        <div style={{
          marginTop: '2rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--panel-border)',
          textAlign: 'center',
          fontSize: '0.55rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}>
          SISTEMA PROVISTO POR <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>RATETAP</span>
        </div>
      </div>
    </div>
  );
}

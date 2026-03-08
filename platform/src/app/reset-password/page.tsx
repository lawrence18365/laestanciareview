'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ color: '#dc2626', fontSize: '0.95rem' }}>
          Enlace invalido. Solicita un nuevo enlace desde la pagina de inicio de sesion.
        </p>
        <a
          href="/login"
          style={{ color: 'var(--amber-600)', fontSize: '0.9rem', marginTop: '1rem', display: 'inline-block' }}
        >
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
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#10003;</div>
        <h2 style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--espresso)' }}>
          Contraseña Actualizada
        </h2>
        <p style={{ color: 'var(--stone-500)', fontSize: '0.9rem' }}>
          Redirigiendo al inicio de sesion...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label
        htmlFor="password"
        style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--stone-700)', marginBottom: '0.4rem' }}
      >
        Nueva Contraseña
      </label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        placeholder="Minimo 8 caracteres"
        style={{
          width: '100%',
          padding: '0.7rem 0.8rem',
          borderRadius: 8,
          border: '1px solid var(--stone-300)',
          marginBottom: '1.2rem',
        }}
      />

      <label
        htmlFor="confirm"
        style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--stone-700)', marginBottom: '0.4rem' }}
      >
        Confirmar Contraseña
      </label>
      <input
        id="confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
        placeholder="Repite la nueva contraseña"
        style={{
          width: '100%',
          padding: '0.7rem 0.8rem',
          borderRadius: 8,
          border: '1px solid var(--stone-300)',
          marginBottom: '1.5rem',
        }}
      />

      {error && (
        <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '0.75rem',
          borderRadius: 8,
          border: 'none',
          background: 'var(--espresso)',
          color: 'var(--warm-white)',
          fontWeight: 600,
          fontSize: '0.95rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.2s',
        }}
      >
        {loading ? 'Actualizando...' : 'Restablecer Contraseña'}
      </button>

      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <a href="/login" style={{ color: 'var(--stone-500)', fontSize: '0.85rem', textDecoration: 'none' }}>
          Volver al Inicio de Sesion
        </a>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--linen)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--warm-white)',
          borderRadius: 12,
          padding: '2.5rem 2rem',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img
            src="/logos/ratetap_logo.png"
            alt="RateTap"
            style={{ height: 56, margin: '0 auto 0.75rem', objectFit: 'contain' }}
          />
          <p style={{ color: 'var(--stone-500)', fontSize: '0.9rem' }}>
            Restablecer Contraseña
          </p>
        </div>

        <Suspense fallback={<p style={{ textAlign: 'center', color: 'var(--stone-500)' }}>Cargando...</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}

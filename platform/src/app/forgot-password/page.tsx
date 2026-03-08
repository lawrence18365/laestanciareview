'use client';

import { useState, useEffect } from 'react';

interface Restaurant {
  id: number;
  name: string;
  slug: string;
}

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

export default function ForgotPasswordPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [slug, setSlug] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/restaurants')
      .then((r) => r.json())
      .then((data) => setRestaurants(data))
      .catch(() => setError('Error al cargar restaurantes'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Algo salio mal');
        return;
      }

      setSent(true);
    } catch {
      setError('Algo salio mal. Por favor intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

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
            Recuperar Contraseña
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--panel-border)', marginBottom: '1.5rem' }} />

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 48,
              height: 48,
              margin: '0 auto 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-dark)',
              fontSize: '1.5rem',
            }}>
              &#9993;
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Si tu restaurante tiene un email registrado, recibiras un enlace para restablecer tu contraseña.
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
              Revisa tu bandeja de entrada y la carpeta de spam.
            </p>
            <a
              href="/login"
              style={{
                display: 'inline-block',
                padding: '0.65rem 1.5rem',
                background: 'var(--text-main)',
                color: 'var(--panel-bg)',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Volver al Inicio de Sesion
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Selecciona tu restaurante y te enviaremos un enlace para restablecer tu contraseña al email del gerente registrado.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="restaurant" style={labelStyle}>
                Restaurante
              </label>
              <select
                id="restaurant"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                style={inputStyle}
              >
                <option value="">Selecciona tu restaurante</option>
                {restaurants.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name}
                  </option>
                ))}
              </select>
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
              {loading ? 'Enviando...' : 'Enviar Enlace'}
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
        )}

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

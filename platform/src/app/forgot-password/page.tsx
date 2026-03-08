'use client';

import { useState, useEffect } from 'react';

interface Restaurant {
  id: number;
  name: string;
  slug: string;
}

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
            style={{ height: 120, margin: '0 auto 0.75rem', objectFit: 'contain', display: 'block' }}
          />
          <p style={{ color: 'var(--stone-500)', fontSize: '0.9rem' }}>
            Recuperar Contraseña
          </p>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9993;</div>
            <p style={{ fontSize: '0.95rem', color: 'var(--stone-700)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Si tu restaurante tiene un email registrado, recibiras un enlace para restablecer tu contraseña.
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--stone-500)', marginBottom: '1.5rem' }}>
              Revisa tu bandeja de entrada y la carpeta de spam.
            </p>
            <a
              href="/login"
              style={{
                display: 'inline-block',
                padding: '0.6rem 1.5rem',
                borderRadius: 8,
                background: 'var(--espresso)',
                color: 'var(--warm-white)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Volver al Inicio de Sesion
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: '0.9rem', color: 'var(--stone-600)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Selecciona tu restaurante y te enviaremos un enlace para restablecer tu contraseña al email del gerente registrado.
            </p>

            <label
              htmlFor="restaurant"
              style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--stone-700)', marginBottom: '0.4rem' }}
            >
              Restaurante
            </label>
            <select
              id="restaurant"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.7rem 0.8rem',
                borderRadius: 8,
                border: '1px solid var(--stone-300)',
                marginBottom: '1.5rem',
                background: 'var(--warm-white)',
                color: 'var(--espresso)',
              }}
            >
              <option value="">Selecciona tu restaurante</option>
              {restaurants.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>

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
              {loading ? 'Enviando...' : 'Enviar Enlace'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <a href="/login" style={{ color: 'var(--stone-500)', fontSize: '0.85rem', textDecoration: 'none' }}>
                Volver al Inicio de Sesion
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

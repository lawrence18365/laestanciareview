'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

interface Restaurant {
  id: number;
  name: string;
  slug: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [slug, setSlug] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/restaurants')
      .then((r) => r.json())
      .then((data) => setRestaurants(data))
      .catch(() => setError(t.login.failedToLoad));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t.login.somethingWrong);
        return;
      }

      router.push(data.role === 'owner' ? '/overview' : '/dashboard');
    } catch {
      setError(t.login.somethingWrong);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.65rem 0.75rem',
    border: '1px solid var(--border-dark)',
    borderRadius: 0,
    fontSize: '0.9rem',
    fontFamily: 'var(--font-sans)',
    background: 'var(--panel-bg)',
    color: 'var(--text-main)',
    transition: 'box-shadow 0.15s ease',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: '0.4rem',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--panel-bg)',
          border: '1px solid var(--border-dark)',
          padding: '2.5rem 2rem',
          boxShadow: '8px 8px 0px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logos/ratetap_logo.png"
            alt="RateTap"
            style={{ height: 120, margin: '0 auto 0.75rem', objectFit: 'contain', display: 'block' }}
          />
          <div style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}>
            {t.login.subtitle}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Divider */}
          <div style={{
            borderTop: '1px solid var(--panel-border)',
            marginBottom: '1.5rem',
          }} />

          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="restaurant" style={labelStyle}>
              {t.login.restaurant}
            </label>
            <select
              id="restaurant"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">{t.login.selectRestaurant}</option>
              {restaurants.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="password" style={labelStyle}>
              {t.login.password}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={t.login.enterPassword}
              style={inputStyle}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                marginBottom: '1rem',
                border: '1px solid var(--red)',
                background: 'var(--red-light)',
                color: 'var(--red)',
                fontSize: '0.8rem',
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.7rem',
              border: 'none',
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
            {loading ? t.login.signingIn : t.login.signIn}
          </button>

          <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <a
              href="/forgot-password"
              style={{
                color: 'var(--text-dim)',
                fontSize: '0.7rem',
                fontWeight: 500,
                textDecoration: 'none',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {t.login.forgotPassword}
            </a>
          </div>
        </form>

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

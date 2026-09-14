'use client';

import { useEffect } from 'react';
import { trackClientError } from '@/lib/analytics-client';

/**
 * Quotaciones failed to render.
 *
 * SECONDARY PROTECTION, NOT A FIX. The outage this exists for (10-14 sep 2026) was
 * a client bundle that threw while being evaluated — before React could render a
 * tree at all — so this boundary would have caught it and shown a working screen
 * instead of the bare global-error fallback. It cannot repair the broken chunk:
 * the underlying throw is what has to be fixed, and it is reported either way, so
 * a boundary that "handles" the error can never hide it from the record.
 *
 * Deliberately narrow: it catches everything under /quotes only, so a failure in
 * the quote list cannot take the whole shell (nav, push banner, analytics) with it.
 */
export default function QuotesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    trackClientError(error, { boundary: 'quotes-segment' });
  }, [error]);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '3rem 1.25rem' }}>
      <h1
        style={{
          margin: 0,
          fontSize: '1.05rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        No se pudieron abrir las cotizaciones
      </h1>
      <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        Ya registramos el error. Nada de lo que estaba guardado se perdió: las cotizaciones
        siguen en el sistema. Intenta de nuevo; si vuelve a fallar, avísanos e incluye el
        folio de la cotización.
      </p>
      {error.digest && (
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Referencia: <code style={{ fontFamily: 'var(--font-mono)' }}>{error.digest}</code>
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={reset}
          style={{
            padding: '0.6rem 1.25rem',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: 'var(--text-main)',
            color: 'var(--panel-bg)',
            border: '1px solid var(--text-main)',
            cursor: 'pointer',
          }}
        >
          Intentar de nuevo
        </button>
        <a
          href="/dashboard"
          style={{
            padding: '0.6rem 1.25rem',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-main)',
            border: '1px solid var(--border-dark)',
            textDecoration: 'none',
          }}
        >
          Volver al panel
        </a>
      </div>
    </div>
  );
}

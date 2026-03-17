'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Algo salio mal</h2>
          <p style={{ color: '#666' }}>Ha ocurrido un error inesperado.</p>
          <button onClick={reset} style={{ padding: '0.5rem 1.5rem', background: '#111', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}

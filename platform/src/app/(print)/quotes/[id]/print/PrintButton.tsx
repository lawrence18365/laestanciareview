'use client';

import { useEffect, useRef } from 'react';

export default function PrintButton() {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoprint') !== '1') return;
    firedRef.current = true;
    // Wait for fonts/images so the PDF the hostess saves looks finished, not
    // half-laid-out. requestAnimationFrame ensures the layout has flushed.
    const fontsReady =
      (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    Promise.resolve(fontsReady).then(() => {
      requestAnimationFrame(() => {
        setTimeout(() => window.print(), 250);
      });
    });
  }, []);

  return (
    <button
      onClick={() => window.print()}
      style={{
        padding: '0.5rem 1.5rem',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: '#fff',
        color: '#1a1a1a',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      Imprimir / Guardar PDF
    </button>
  );
}
